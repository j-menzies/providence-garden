# Providence Garden — Knowledge Repository

> **PlatinumMethod knowledge vault** for **Providence Garden**.
> A field register for the Providence Square gardens, run by the garden committee of Jacob's Island Residents Association (JIRA). The prototype, a browser-only PWA, proved capturing plants, services and wildlife features with photos and positions. This work turns it into a multi-user app on native Firebase: shared data, sign-in for the committee, a public view for observers, and a data-first UI with a map view.

## Executive Summary

This repository implements the PlatinumMethod for Providence Garden, providing structured documentation that supports analysis, design decision-making, and implementation planning. It serves as the single source of truth for architectural decisions, requirements, and technical specifications.

### Project Overview

- **Project**: Providence Garden
- **Scope**: A field register for the Providence Square gardens, run by the garden committee of Jacob's Island Residents Association (JIRA). The prototype, a browser-only PWA, proved capturing plants, services and wildlife features with photos and positions. This work turns it into a multi-user app on native Firebase: shared data, sign-in for the committee, a public view for observers, and a data-first UI with a map view.
- **Analysis Type**: brownfield_modernisation
- **Created**: 2026-11-05

### Key Technologies

- TypeScript
- React
- Vite
- MapLibre GL
- Firebase
- Firestore
- Cloud Storage
- Terraform

### Business Domains

- Garden register
- Observations
- Photos
- Calendar
- Members and roles
- Maps

## Navigation

Start with [Method MOC.md](Method%20MOC.md) — the vault's map of content. It links to every section, register, and skill workflow.

## Front-matter Schema

Every note in this vault carries YAML front-matter validated against [SCHEMA.md](SCHEMA.md). When creating new notes, start from a template in [_templates/](_templates/) or use the `pm-*` skill family.

## Maintaining the vault

- **Add an ADR**: `/pm-adr`
- **Add a requirement**: `/pm-requirement`
- **Refresh registers in Method MOC**: handled automatically by the `pm-*` skills.

For everything else, edit notes directly in Obsidian or your editor of choice.

## Methodology Attribution

This repository was created using **PlatinumMethod™**, a proprietary methodology developed by John Menzies of Think Platinum Consulting.

- **Consultant**: John Menzies
- **Contact**: 29292945+j-menzies@users.noreply.github.com

*PlatinumMethod™ © 2025 John Menzies. All rights reserved.*
