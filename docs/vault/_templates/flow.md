---
title: "<Flow title>"
type: flow
status: draft
flow_type: user-journey
diagram: mermaid
phase: 07_flows
tags: []
related: []
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
platinum_lock: none
export_visibility: internal
---

# <Flow title>

## Purpose

<What journey or interaction does this document, and for whom?>

## Actors

- <actor> — <role>

## Preconditions

- <state required before the flow begins>

## Flow

```mermaid
flowchart TD
    Start([Start]) --> Step1[Step 1]
    Step1 --> Decision{Decision}
    Decision -->|yes| Step2[Step 2]
    Decision -->|no| End([End])
    Step2 --> End
```

## Steps

1. <Numbered, prose description matching the diagram>
2. ...

## Postconditions

- <state after the flow completes>

## Edge Cases

- <unhappy path or edge> — <handling>

## References

- <relative link to related requirements, ADRs, or specs>
