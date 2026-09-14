{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]
    ],
    "subject-empty": [2, "never"],
    "subject-max-length": [2, "always", 72],
    "body-max-line-length": [2, "always", 72],
    "footer-max-line-length": [2, "always", 72],
    "type-case": [2, "always", "lower-case"]
  }
}
