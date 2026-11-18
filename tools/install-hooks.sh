#!/bin/sh
# run once in every fresh clone: makes git use the hooks stored in this repo
git config core.hooksPath tools/hooks && echo "hooks installed (version bump + README check on every commit)"
