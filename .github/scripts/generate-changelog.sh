#!/usr/bin/env bash
set -euo pipefail

# Group commits by conventional-commit prefix for release notes.
# Usage: generate-changelog.sh <range> (e.g. v1.15.0..HEAD or HEAD)
range="${1:-HEAD}"

git log --no-merges --pretty=format:%s "$range" | awk '
    function label(t) {
        if (t == "feat")       return "Features"
        if (t == "fix")        return "Bug Fixes"
        if (t == "perf")       return "Performance"
        if (t == "security")   return "Security"
        if (t == "refactor")   return "Refactoring"
        if (t == "docs")       return "Documentation"
        if (t == "test")       return "Tests"
        if (t == "ci" || t == "build") return "Build / CI"
        return "Other"
    }
    {
        match($0, /^[a-z]+/)
        type = (RSTART > 0 ? substr($0, RSTART, RLENGTH) : "")
        group = label(type)
        groups[group] = groups[group] "\n- " $0
    }
    END {
        order = "Features\nBug Fixes\nPerformance\nSecurity\nRefactoring\nDocumentation\nTests\nBuild / CI\nOther"
        n = split(order, names, "\n")
        for (i = 1; i <= n; i++) {
            if (groups[names[i]] != "") {
                print ""
                print "### " names[i]
                print groups[names[i]]
            }
        }
    }
'