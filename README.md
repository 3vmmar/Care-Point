# Dr. Ashraf Metwally — Future Clinic Demo

A premium bilingual patient experience and connected clinic operations demo.

## Demo surfaces

- `/` — editorial clinic website, CareLens, NOOR concierge, and live booking
- `/command-center` — operations dashboard with incoming website reservations

## Local development

```bash
npm install
npm run dev
```

The booking flow uses a local Cloudflare D1 database in development. The
appointments table is created defensively by the booking service; its Drizzle
migration is also committed in `drizzle/`.

## Quality checks

```bash
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
```

This is a presentation-ready demo. Before a public launch, replace demo phone
links, connect clinic messaging and calendar providers, add authentication to
the command center, and complete clinical/legal content approval.
