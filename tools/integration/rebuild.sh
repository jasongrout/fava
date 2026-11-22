#!/usr/bin/env bash
# Rebuild the integration branch: upstream main with every branch listed in
# branches.txt merged into it. See README.md in this directory.
#
# Usage: tools/integration/rebuild.sh [--push]
#
# Environment overrides: REMOTE (default: origin), TARGET (integration),
# ARCHIVE (integration-archive), TOOLS_BRANCH (integration-tools),
# UPSTREAM_URL, UPSTREAM_BRANCH (main).
set -euo pipefail

REMOTE="${REMOTE:-origin}"
TARGET="${TARGET:-integration}"
ARCHIVE="${ARCHIVE:-integration-archive}"
TOOLS_BRANCH="${TOOLS_BRANCH:-integration-tools}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/beancount/fava.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
LIST_PATH="tools/integration/branches.txt"

push=false
case "${1:-}" in
  --push) push=true ;;
  "") ;;
  *)
    echo "usage: $0 [--push]" >&2
    exit 2
    ;;
esac

git rev-parse --git-dir >/dev/null

echo "Fetching $REMOTE and $UPSTREAM_URL $UPSTREAM_BRANCH"
git fetch --quiet --prune "$REMOTE"
git fetch --quiet "$UPSTREAM_URL" "$UPSTREAM_BRANCH"
upstream=$(git rev-parse FETCH_HEAD)

# Branches to merge: the tools branch first, then those in the list. The list
# is read into a variable so that a failing 'git show' stops the script (set -e
# does not see failures in a process substitution), and fed to the loop as a
# here-string, which supplies the newline 'read' needs for the last line.
list=$(git show "refs/remotes/$REMOTE/$TOOLS_BRANCH:$LIST_PATH")
branches=("$TOOLS_BRANCH")
while IFS= read -r line; do
  line="${line%%#*}"
  line="${line//[[:space:]]/}"
  if [ -n "$line" ]; then
    branches+=("$line")
  fi
done <<<"$list"

for b in "${branches[@]}"; do
  if ! git rev-parse --verify --quiet "refs/remotes/$REMOTE/$b" >/dev/null; then
    echo "error: branch $REMOTE/$b does not exist" >&2
    exit 1
  fi
done

old=$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/$TARGET" || true)
archive=$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/$ARCHIVE" || true)

worktree=$(mktemp -d "${TMPDIR:-/tmp}/fava-integration.XXXXXX")
keep_worktree=false
cleanup() {
  if [ "$keep_worktree" = false ]; then
    git worktree remove --force "$worktree" 2>/dev/null || rm -rf "$worktree"
    git worktree prune
  fi
}
trap cleanup EXIT

git worktree add --quiet --detach "$worktree" "$upstream"

# rerere records conflict resolutions in this clone and replays them on the
# next rebuild, so a conflict only has to be resolved once.
wt_git() {
  git -C "$worktree" -c rerere.enabled=true -c rerere.autoUpdate=true "$@"
}

# Commits contained in the result, for the up-to-date check below. Branches
# skipped because their changes are already upstream are not included.
contained=("$upstream")

for b in "${branches[@]}"; do
  ref="refs/remotes/$REMOTE/$b"
  if wt_git merge-base --is-ancestor "$ref" HEAD; then
    echo "skip   $b (already contained in upstream)"
    continue
  fi
  before=$(wt_git rev-parse HEAD)
  if ! wt_git merge --quiet --no-ff --no-edit \
    -m "Merge branch '$b' into $TARGET" "$ref"; then
    if ! wt_git rev-parse --quiet --verify MERGE_HEAD >/dev/null; then
      echo "error: merging $b failed" >&2
      exit 1
    elif [ -z "$(wt_git diff --name-only --diff-filter=U)" ]; then
      echo "rerere resolved the conflicts merging $b"
      wt_git commit --quiet --no-edit --cleanup=strip
    else
      keep_worktree=true
      cat >&2 <<EOF
error: conflict merging $b.
Resolve the conflicts in
  $worktree
and record the resolution with
  git -C $worktree -c rerere.enabled=true commit --no-edit --cleanup=strip
then remove the worktree with
  git worktree remove --force $worktree
and run this script again. git rerere remembers the resolution in this
clone, so this and all later rebuilds apply it automatically.
EOF
      exit 1
    fi
  fi
  if wt_git diff --quiet "$before" HEAD; then
    # Changes already in upstream, e.g., after a squash merge of the PR.
    wt_git reset --quiet --hard "$before"
    echo "skip   $b (no changes on top of upstream; remove it from the list?)"
    continue
  fi
  contained+=("$ref")
  echo "merged $b"
done

new=$(wt_git rev-parse HEAD)

# Avoid rewriting the branch if nothing changed.
publish="$new"
if [ -n "$old" ] && git diff --quiet "$old" "$new"; then
  up_to_date=true
  for ref in "${contained[@]}"; do
    if ! git merge-base --is-ancestor "$ref" "$old"; then
      up_to_date=false
      break
    fi
  done
  if [ "$up_to_date" = true ]; then
    echo "$REMOTE/$TARGET is up to date ($old)"
    publish="$old"
  fi
fi

# Every published commit is kept reachable from the append-only archive
# branch, so that it can still be fetched by its hash (e.g., when pinned in a
# pixi.toml or requirements file) after the integration branch was rewritten.
# Each archive commit has the previous archive tip and the published commit
# as parents and the published commit's tree.
refspecs=()
if [ "$publish" != "$old" ]; then
  refspecs+=("$publish:refs/heads/$TARGET")
fi
if [ -z "$archive" ] || ! git merge-base --is-ancestor "$publish" "$archive"; then
  commit_args=("$publish^{tree}")
  if [ -n "$archive" ]; then
    commit_args+=(-p "$archive")
  fi
  commit_args+=(-p "$publish" -m "Archive $TARGET $publish")
  archive_new=$(git commit-tree "${commit_args[@]}")
  refspecs+=("$archive_new:refs/heads/$ARCHIVE")
fi

if [ "${#refspecs[@]}" -eq 0 ]; then
  echo "$publish is already archived in $REMOTE/$ARCHIVE"
elif [ "$push" = true ]; then
  # Atomic, so that the branch is never published without being archived. The
  # archive is only ever fast-forwarded; the lease protects the target.
  git push --atomic --force-with-lease="$TARGET:$old" "$REMOTE" "${refspecs[@]}"
  echo "Pushed ${refspecs[*]#*:refs/heads/} to $REMOTE"
else
  echo "Not pushed. To publish $TARGET as $publish and archive it:"
  echo "  $0 --push"
  exit 0
fi

echo
echo "To pin this build, e.g., in the [pypi-dependencies] of a pixi.toml, from"
echo "$REMOTE or from this clone (after fetching $REMOTE):"
echo "  fava = { git = \"$(git remote get-url "$REMOTE")\", rev = \"$publish\" }"
echo "  fava = { git = \"file://$(git rev-parse --show-toplevel)\", rev = \"$publish\" }"
