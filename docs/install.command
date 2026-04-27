#!/usr/bin/env bash
# ScrollLearn installer launcher.
# Double-click in Finder to install ScrollLearn on macOS.
# (If macOS warns "cannot be opened", right-click -> Open the first time.)
set -euo pipefail
exec curl -fsSL https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.sh | bash
