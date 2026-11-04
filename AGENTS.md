# Skill maintenance

- This repository owns the standalone `sublang` Skill. The SPEX runtime packages under `runtime/vendor` are pinned upstream artifacts.
- Use Git commits and tags for version history, not routine backup copies or replacement directories.
- After editing distributed Skill files, run `node scripts/update-release.mjs`, then the native setup entry and relevant checks before committing.
- Preserve user configuration, authentication and uncommitted work. Commit and push when authorized by the current task.
- Retain the user's Windows endpoint permission exception; distinguish Windows simulation from native Windows results.
