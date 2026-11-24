#!/bin/sh
set -eu

revision=24cb510288566eba0e33ff55949adb54c0a89fac
if [ ! -d hashspace/.git ]; then
    git init -q hashspace
fi
if [ "$(git -C hashspace rev-parse --verify HEAD 2>/dev/null || true)" != "$revision" ]; then
    git -C hashspace fetch --depth 1 https://github.com/divdavem/hashspace.git "$revision"
    git -C hashspace checkout --detach FETCH_HEAD
fi
