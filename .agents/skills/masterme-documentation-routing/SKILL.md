---
name: masterme-documentation-routing
description: Route MasterMe backend work to the minimum relevant versioned documentation before planning or editing. Use for any backend change, review, deployment, migration, security, AI, or payment task.
---

# MasterMe backend documentation routing

Read `AGENTS.md` first. Then read the applicable entries in
[documentation-map.md](references/documentation-map.md) before planning or
editing. Read only the minimum set selected by the task; the map is a routing
aid, not a mandate to read every document.

For every code task, also follow the local engineering workflow: create a
temporary PRD before implementation, record whether the global PRD needs a
targeted update, validate, and obtain independent review. Do not rewrite a
stable document merely because the task touched adjacent code. Refactor only
when reducing future change cost is an explicit, evidenced goal.
