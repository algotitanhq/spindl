# Release: the public repository, one commit

Same procedure as Uberblok. The working repository stays private; the public repository `algotitanhq/spindl` holds a
single commit, the tree of the validated `main`, without the working history. The owner's Go is the only gate: it
comes before step 3, and the owner sets `PUBLIC_RELEASE=true` on the public repository afterwards (step 4).

## 1. Check the tree

On a clean clone, at the commit of `main` the owner validated:

```sh
SHA=<the validated commit of main>
git switch --detach "$SHA"
npm ci && npm test                       # the figures, the root language choice, the build
git grep -I -n -i -E -f /path/to/private-patterns.txt "$SHA"     # the team's list of private names: nothing
git grep -I -n -E '192\.168\.|10\.[0-9]+\.[0-9]+\.[0-9]+|/home/[a-z]|/Users/[a-z]' "$SHA"
git grep -I -n -E 'BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|github_pa[t]_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|https?://[^/ ]+:[^@/ ]+@' "$SHA"
```

The study photos of real drives (`hdd/ref/`) are not tracked: they belong to Aesonlabs, iFixit and Wikimedia
contributors. `hdd/REFERENCES.md` links them. Check that nothing under `hdd/ref/` is in the tree:

```sh
git ls-tree -r --name-only "$SHA" | grep '^hdd/ref/' && echo "STOP: study photos tracked"
```

The binary files are the share card and the favicon; check that they carry no metadata:

```sh
git ls-tree -r --name-only "$SHA" | grep -E '\.(png|jpe?g|webp|gif)$'
# static/og.png: rendered from the film, written by ffmpeg with -map_metadata -1
```

## 2. Build the one-commit repository

```sh
OUT=$(mktemp -d)/spindl
mkdir -p "$OUT"
git archive --format=tar "$SHA" | tar -x -C "$OUT"
cd "$OUT"
git init -q -b main --template=
git add -A
git -c user.name="<author name>" -c user.email="<author noreply email>" \
  commit -q -m "Spindl, a 3.5-inch 7,200 rpm hard drive taken apart in the browser"
test "$(git rev-list --count HEAD)" = 1 && test -z "$(git remote)" && echo "one commit, no remote"
```

## 3. Publish (after the owner's Go)

```sh
cd "$OUT"
gh repo create algotitanhq/spindl --public --source . --remote origin --push \
  --description "Spindl: a 3.5-inch 7,200 rpm hard drive you can take apart in the browser" \
  --homepage https://spindl.storagebits.workers.dev
gh repo edit algotitanhq/spindl --add-topic showcase --add-topic hard-drive --add-topic threejs --add-topic simulation --add-topic storage
gh repo view algotitanhq/spindl --json visibility,defaultBranchRef     # PUBLIC, main
```

The first push runs CI without deploying: `PUBLIC_RELEASE` is not set yet. The `showcase` topic makes the project
appear on blok by itself at the next build.

## 4. First deploy (the owner)

```sh
gh variable set PUBLIC_RELEASE --body true -R algotitanhq/spindl
gh workflow run ci.yml --ref main -R algotitanhq/spindl
gh run watch -R algotitanhq/spindl
curl -sI https://spindl.storagebits.workers.dev/ | head -3          # 302 to /en/ (or the browser's language)
```

The organization secret `CLOUDFLARE_API_TOKEN` must be visible to the new repository (organization settings,
secret access: all repositories, or add `spindl` to the selected ones).
