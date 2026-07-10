# Nutrition App - Codex Instructions

## Project mission

Build a production-quality mobile application that helps users track calories, macronutrients, and meal history through camera-assisted analysis and accurate manual entry.

Accuracy, transparency, privacy, and maintainability are more important than quickly generating features.

## Source of project knowledge

Before planning or implementing substantial work, read `docs/Current State.md` first.

Then consult the relevant project documents:

1. `docs/Home.md`
2. `docs/Product Vision.md`
3. `docs/Current State.md`
4. `docs/Architecture.md`
5. `docs/Roadmap.md`
6. `docs/Decisions.md`
7. `docs/Known Issues.md`
8. Feature documentation under `docs/product/`
9. API documentation under `docs/api/`
10. Accuracy documentation under `docs/accuracy/`
11. Privacy documentation under `docs/privacy/`

Treat these documents as the project’s persistent knowledge base.

When documentation and code disagree:

1. Inspect the implementation.
2. Identify the inconsistency.
3. Treat the implementation as the source of truth for current behavior.
4. Report the conflict instead of silently rewriting historical decisions.
5. Recommend which current-state or planning document should be updated.

## Working process

For substantial changes:

1. Read the relevant project documentation.
2. Inspect the existing implementation.
3. Explain the current behavior.
4. Produce a concise implementation plan.
5. Identify files that will change.
6. Implement the smallest complete solution.
7. Run the appropriate tests, linting, formatting, and type checks.
8. Review the resulting diff.
9. Update the relevant project documentation.

Do not start a major rewrite without first explaining why it is necessary.

## Documentation responsibilities

Update `docs/Current State.md` when the implementation status meaningfully changes.

Update `docs/Architecture.md` when introducing or changing:

- Services
- Databases
- External APIs
- Authentication
- State-management architecture
- Background processing
- Data flow
- Deployment architecture

Record significant technical decisions in `docs/Decisions.md`.

Record newly discovered technical debt or unresolved defects in `docs/Known Issues.md`.

Do not rewrite historical decisions merely because the implementation changed. Mark decisions as superseded when appropriate.

## Obsidian conventions

- Use Markdown for project documentation.
- Use Obsidian internal links such as `[[Architecture]]`.
- Preserve existing YAML frontmatter.
- Use ISO dates in `YYYY-MM-DD` format.
- Do not edit `.obsidian/` unless explicitly instructed.
- Do not rename or move notes without updating internal links.
- Do not delete notes without explicit approval.

## Engineering standards

- Prefer TypeScript over new JavaScript files.
- Keep UI, domain logic, API access, and persistence concerns separated.
- Validate external data at system boundaries.
- Never trust AI-generated nutrition estimates without user confirmation.
- Never present uncertain nutrition values as exact.
- Keep secrets and API keys out of source control.
- Add or update tests for meaningful behavior changes.
- Avoid unnecessary dependencies.
- Follow the existing project conventions unless there is a documented reason to change them.

## Nutrition-data requirements

Nutrition calculations must preserve:

- Data source
- Food identifier
- Serving amount
- Serving unit
- Weight in grams when available
- Calories
- Protein
- Carbohydrates
- Fat
- Confidence or estimation status
- Whether the user manually corrected the result

Do not describe camera-based portion or nutrition estimation as perfectly accurate.

Prefer authoritative food-composition data over model-generated nutrition values.

## Safety rules

- Never expose API keys, tokens, passwords, or personal user data.
- Never commit `.env` files.
- Never perform destructive database operations without explicit approval.
- Never delete broad sets of files without showing what will be removed.
- Keep generated changes within this repository unless explicitly instructed otherwise.
- Preserve user-authored notes and research whenever possible.

## Definition of done

A task is complete only when:

- The requested behavior is implemented.
- Relevant checks pass.
- Error and loading states are considered.
- No obvious regression was introduced.
- The diff has been reviewed.
- Relevant project documentation is updated.
- Remaining limitations are stated clearly.
