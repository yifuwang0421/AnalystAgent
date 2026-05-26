# Trademark Policy

This trademark policy explains how this repository treats the "Craft" and "Analyst Agent" names, logos, and branding.

## Trademarks

The Craft name and related upstream branding belong to their respective owners. Analyst Agent is an independent project based on the Craft Agent / Craft Agents OSS codebase.

- **Craft** and upstream Craft Agent marks
- **Analyst Agent** project name and repository branding

## What You Can Do

### Use the Code Freely

The Analyst Agent source code is licensed under the Apache License 2.0. You are free to:

- Use, modify, and distribute the code
- Create derivative works
- Use the software for any purpose, including commercial use

### Make Factual Statements

You may make accurate, factual statements about your relationship to the project:

- "Based on Craft Agent / Craft Agents OSS"
- "Based on Analyst Agent"
- "Compatible with Analyst Agent"
- "Fork of Analyst Agent"

### Contribute to the Project

Contributors to the official Analyst Agent repository may use the trademarks when discussing their contributions.

## What You Cannot Do

### Use Upstream Branding for Forks

If you create a fork or derivative work, you **must**:

- Choose a different name that does not include "Craft"
- Remove or replace all Analyst Agent logos and icons
- Update the bundle identifier to your own
- Remove references to `craft.do` domains unless connecting to official Craft services

### Imply Official Endorsement

You may not:

- Use "Craft" or "Analyst Agent" as your product name in a way that creates confusion
- Use the Analyst Agent logo as your application icon
- Suggest that your fork is the official version
- Imply that Craft Docs Ltd., Craft, or this repository endorses your product

### Create Confusion

You may not use the trademarks in any way that:

- Suggests your product is created by or affiliated with Craft Docs Ltd. or this repository
- Could cause confusion between your product and Analyst Agent
- Disparages upstream Craft Agent maintainers or the Analyst Agent project

## Branding Locations

For those creating forks, the following files contain branding that should be updated:

| File | Contains |
|------|----------|
| `apps/electron/electron-builder.yml` | Product name, bundle ID, copyright |
| `apps/electron/resources/` | Application icons |
| `packages/shared/src/branding.ts` | Service URLs |

## Examples

### Acceptable

- "MyAgent - based on Analyst Agent"
- "This project is a fork of Analyst Agent"
- "Compatible with the Analyst Agent ecosystem"

### Not Acceptable

- "Analyst Agent Pro"
- "Analyst Agent for Linux"
- "Better Analyst Agent"
- Using the Analyst Agent logo for your fork

## Questions

If you have questions about this trademark policy, please open an issue in this repository.

## Changes

This policy may be updated from time to time. The current version will always be available in this repository.

---

*This trademark policy is inspired by similar policies from Mozilla, WordPress, and the Apache Software Foundation.*
