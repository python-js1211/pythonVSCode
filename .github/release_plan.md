# Beta (Tuesday, XXX XX)

- [ ] Update the version in [`package.json`](https://github.com/Microsoft/vscode-python/blob/master/package.json)
- [ ] Run `npm install` to make sure [`package-lock.json`](https://github.com/Microsoft/vscode-python/blob/master/package.json) is up-to-date
- [ ] Update [`CHANGELOG.md`](https://github.com/Microsoft/vscode-python/blob/master/CHANGELOG.md)
   - [ ] Create a new section for this release
   - [ ] Run [`news`](https://github.com/Microsoft/vscode-python/tree/master/news) (typically `python news | code-insiders -`)
   - [ ] Touch up news entries (and corresponding news entry files)
   - [ ] Copy over the "Thanks" section from the previous release
- [ ] Update [`ThirdPartyNotices-Distribution.txt`](https://github.com/Microsoft/vscode-python/blob/master/ThirdPartyNotices-Distribution.txt)
   - [ ] Run [`tpn`](https://github.com/Microsoft/vscode-python/tree/master/tpn) (typically `python tpn --npm package-lock.json --npm-overrides package.datascience-ui.dependencies.json --config tpn/distribution.toml ThirdPartyNotices-Distribution.txt`)
   - [ ] Register any Python changes with [OSPO](https://opensource.microsoft.com/)
- [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-python/blob/master/ThirdPartyNotices-Repository.txt) and register any changes with OSPO
- [ ] Open appropriate [documentation issues](https://github.com/microsoft/vscode-docs/issues?q=is%3Aissue+is%3Aopen+label%3Apython)
- [ ] Check that component governance is happy (requires beta PR to have been merged)


# Release candidate (Tuesday, XXX XX)

- [ ] Ensure all new features are tracked via telemetry
- [ ] Announce a code freeze
- [ ] Create a branch against `master` for a pull request
- [ ] Update the version in [`package.json`](https://github.com/Microsoft/vscode-python/blob/master/package.json)
- [ ] Run `npm install` to make sure [`package-lock.json`](https://github.com/Microsoft/vscode-python/blob/master/package.json) is up-to-date
- [ ] Update [`CHANGELOG.md`](https://github.com/Microsoft/vscode-python/blob/master/CHANGELOG.md)
   - [ ] Update version and date for the release section
   - [ ] Run [`news`](https://github.com/Microsoft/vscode-python/tree/master/news) (typically `python news --final | code-insiders -`; the `--final` flag is on purpose as no more changes are expected)
   - [ ] Touch up news entries (and corresponding news entry files)
   - [ ] Check that the "Thanks" section is up-to-date
- [ ] Update [`ThirdPartyNotices-Distribution.txt`](https://github.com/Microsoft/vscode-python/blob/master/ThirdPartyNotices-Distribution.txt)
   - [ ] Run [`tpn`](https://github.com/Microsoft/vscode-python/tree/master/tpn) (typically `python tpn --npm package-lock.json --npm-overrides package.datascience-ui.dependencies.json --config tpn/distribution.toml ThirdPartyNotices-Distribution.txt`)
   - [ ] Register any Python changes with [OSPO](https://opensource.microsoft.com/)
- [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-python/blob/master/ThirdPartyNotices-Repository.txt) and register any changes with OSPO
- [ ] Merge pull request into `master`
- [ ] Delete the `release` branch in the repo
- [ ] Create a new `release` branch from `master`
- [ ] Bump the version number to the next release in the `master` branch
  - [ ] `package.json`
  - [ ] `package-lock.json`
- [ ] Announce the code freeze is over
- [ ] Open appropriate [documentation issues](https://github.com/microsoft/vscode-docs/issues?q=is%3Aissue+is%3Aopen+label%3Apython)
- [ ] Begin drafting a [blog](http://aka.ms/pythonblog) post
- [ ] Make sure component governance is happy (requires RC PR to have been merged)


# Final (Tuesday, XXX XX)

## Preparation

- [ ] Make sure the [appropriate pull requests](https://github.com/microsoft/vscode-docs/pulls) for the [documentation](https://code.visualstudio.com/docs/python/python-tutorial) -- including the [WOW](https://code.visualstudio.com/docs/languages/python) page -- are ready
- [ ] Create a branch against `release` for a pull request
- [ ] Update the version in [`package.json`](https://github.com/Microsoft/vscode-python/blob/master/package.json)
- [ ] Run `npm install` to make sure [`package-lock.json`](https://github.com/Microsoft/vscode-python/blob/master/package.json) is up-to-date (the only update should be the version number if `package-lock.json` has been kept up-to-date)
- [ ] Update [`CHANGELOG.md`](https://github.com/Microsoft/vscode-python/blob/master/CHANGELOG.md)
   - [ ] Update version and date for the release section
   - [ ] Run [`news`](https://github.com/Microsoft/vscode-python/tree/master/news) (typically `python news --final | code-insiders -`)
   - Check that the "Thanks" section is up-to-date
- [ ] Update [`ThirdPartyNotices-Distribution.txt`](https://github.com/Microsoft/vscode-python/blob/master/ThirdPartyNotices-Distribution.txt)
   - [ ] Run [`tpn`](https://github.com/Microsoft/vscode-python/tree/master/tpn) (typically `python tpn --npm package-lock.json --npm-overrides package.datascience-ui.dependencies.json --config tpn/distribution.toml ThirdPartyNotices-Distribution.txt`)
   - [ ] Register any Python changes with component governance
- [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-python/blob/master/ThirdPartyNotices-Repository.txt) and register any changes with OSPO
- [ ] Merge pull request into `release`
- [ ] Make sure component governance is happy

## Release

- [ ] Make sure [CI](https://github.com/Microsoft/vscode-python/blob/master/CONTRIBUTING.md) is passing
- [ ] Generate the final `.vsix` file
- [ ] Make sure no extraneous files are being included in the `.vsix` file (make sure to check for hidden files)
- [ ] Upload the final `.vsix` file to the [marketplace](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
- [ ] Publish [documentation changes](https://github.com/microsoft/vscode-docs/pulls)
- [ ] Publish the [blog](http://aka.ms/pythonblog) post
- [ ] Create a [release](https://github.com/Microsoft/vscode-python/releases) on GitHub (which creates an appropriate git tag)
- [ ] Determine if a hotfix is needed
- [ ] Merge `release` back into `master`

## Prep for the _next_ release
- [ ] Bump the [version](https://github.com/Microsoft/vscode-python/blob/master/package.json) number to the next `alpha`
- [ ] Create a new [release plan](https://github.com/Microsoft/vscode-python/edit/master/.github/release_plan.md)

## Clean up after _this_ release
- [ ] Clean up any straggling [fixed issues needing validation](https://github.com/Microsoft/vscode-python/issues?q=label%3A%22validate+fix%22)
- [ ] Go through [`needs more info` issues](https://github.com/Microsoft/vscode-python/issues?q=is%3Aopen+label%3A%22info+needed%22+sort%3Acreated-asc) and close any that have no activity for over a month
