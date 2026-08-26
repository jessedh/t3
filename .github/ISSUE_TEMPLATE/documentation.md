---
name: Documentation is wrong
about: A document claims something the code does not do
title: ''
labels: documentation
assignees: ''
---

## The claim

**File and line:**

> <!-- quote the claim -->

## What the code actually does

<!-- file:line, plus the command you ran to verify it if you have one -->

<!--
  These reports are especially welcome. Several claims in this repository were
  true when written and silently invalidated by later work, which is why
  scripts/check-doc-claims.js exists — but it only catches unresolvable NAMES and
  PATHS, not claims about behaviour. Behavioural drift needs human eyes.
-->
