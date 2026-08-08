# iOS performance runtime

Test cat prepares a platform-specific Python runtime at build time and installs
`pymobiledevice3==10.3.1` into it. Generated runtime files are intentionally not
stored in Git. Run `npm run prepare:ios-runtime` on the target operating system
before packaging.

- Windows uses the official Python 3.10.11 embeddable distribution.
- macOS uses a Python 3.10 install-only build from python-build-standalone.
- Python and all installed packages retain their upstream license files inside
  the generated runtime.
