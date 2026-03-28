# Expert Dashboard Docs

This directory contains focused documentation for the expert dashboard.

## Contents

- [Architecture](./architecture.md)
- [Routes](./routes.md)
- [Development Workflow](./development.md)

## Purpose

The expert dashboard is the required web fallback/control layer in the Synapse XR hybrid architecture:
- Worker: AR-first Unity app
- Expert: VR/AR-first Unity app + ESP32 glove
- Dashboard: session control, debugging, and operational fallback

Keep this folder updated when:
- Routes are added or changed
- Backend API usage changes
- Auth/session flows are refactored
- Runtime dependencies or env configuration changes
