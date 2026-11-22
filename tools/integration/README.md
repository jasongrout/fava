# Integration branch

The `integration` branch of this fork is upstream `beancount/fava` `main` with
every branch listed in [`branches.txt`](branches.txt) merged into it. It is
meant for running the fork locally with all pending PRs applied.

The branch is rebuilt from scratch by [`rebuild.sh`](rebuild.sh), so its history
is rewritten on every rebuild. Do not base work on it; branch off upstream
`main` instead and add the branch to `branches.txt`.

## Rebuilding

From any clone of the fork whose `origin` is the fork:

```bash
tools/integration/rebuild.sh          # build and report, without pushing
tools/integration/rebuild.sh --push   # build and force-push (with lease)
```

The script fetches upstream `main` and the listed branches, merges them in a
temporary worktree (your checkout is not touched), and only pushes if the result
differs from the current `integration` branch.

- A branch whose changes are already in upstream (e.g., after its PR was merged)
  is skipped with a note; remove it from `branches.txt`.
- On a merge conflict, the script stops and leaves its worktree for you to
  resolve the conflicts in, and prints the commands to record the resolution and
  remove the worktree. Then run the script again: `git rerere` remembers the
  resolution in your clone and applies it on this and later rebuilds.
- If `branches.txt` cannot be read or lists a branch that does not exist, the
  script stops without building anything.

## Pinning a build

Every published build is also kept in the append-only `integration-archive`
branch: on each push, the script adds a commit to it whose parents are the
previous archive tip and the new `integration` commit. So a build stays
reachable, and can be fetched by its hash, after `integration` has been rebuilt.
The archive is only ever fast-forwarded and pushed atomically with
`integration`.

After a push, the script prints the line to pin the build, e.g., in the
`[pypi-dependencies]` of a `pixi.toml`:

```toml
fava = { git = "https://github.com/jasongrout/fava", rev = "<commit hash>" }
```

Building Fava from git compiles the frontend with `npm`, so add `nodejs` to the
`[dependencies]` of the `pixi.toml` as well.

## Changing the list

Edit `branches.txt` on the `integration-tools` branch, push it, and rerun the
script. The script reads the list from `origin/integration-tools`.

## Updating a local checkout

Since the branch is rewritten, update with a reset rather than a pull:

```bash
git fetch origin
git checkout integration
git reset --hard origin/integration
```
