#!/bin/bash
# MyClass macOS 封裝腳本 (終端機執行)
cd "$(dirname "$0")"
exec ./build-mac.command "$@"
