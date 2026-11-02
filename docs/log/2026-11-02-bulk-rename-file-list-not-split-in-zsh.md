# 2026-11-02: Bulk rename passed the whole file list as one file name

- **Area:** tooling
- **Author:** Oluwaseyi Oyewunmi (+ agent)
- **Symptom:** Renaming the brand with `files=$(grep -rl ...) && perl -pi -e '...' $files`
  failed with `Can't open src/mocks/adminCashMock.ts\nsrc/mocks/adminMock.ts ...: File name too long`
  and changed nothing.
- **Cause:** The shell was zsh, which does not split an unquoted variable on
  whitespace the way Bash does, so perl received one huge argument.
- **Fix / workaround:** Pipe the list instead: `grep -rl "Old" src | xargs perl -pi -e 's/Old/New/g'`.
  Works the same in Bash, zsh and Git Bash.
- **Status:** resolved
- **Refs:** `feat/waterline-redesign` (MmiriOma → Waterline on screen).
