# CLAUDE.md — Frontend Website Rules

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.

## Reference Images
- If a reference image is provided: match layout, spacing, typography, and color exactly. Swap in placeholder content (images via `https://placehold.co/`, generic copy). Do not improve or add to the design.
- If no reference image: design from scratch with high craft (see guardrails below).
- Screenshot your output, compare against reference, fix mismatches, re-screenshot. Do at least 2 comparison rounds. Stop only when no visible differences remain or user says so.

## Local Server
- **Always serve on localhost** — never screenshot a `file:///` URL.
- Start the dev server: `vercel dev` (serves frontend + `/api/*` functions)
- Runs on `http://localhost:3002`
- If the server is already running, do not start a second instance.

## Screenshot Workflow
- Puppeteer is installed in `./node_modules/puppeteer/`. Chrome cache is at `~/Library/Caches/puppeteer/`.
- **Always screenshot from localhost:** `node screenshot.mjs http://localhost:3002`
- Screenshots are saved automatically to `./temporary screenshots/screenshot-N.png` (auto-incremented, never overwritten).
- Optional label suffix: `node screenshot.mjs http://localhost:3000 label` → saves as `screenshot-N-label.png`
- `screenshot.mjs` lives in the project root. Use it as-is.
- After screenshotting, read the PNG from `temporary screenshots/` with the Read tool — Claude can see and analyze the image directly.
- When comparing, be specific: "heading is 32px but reference shows ~24px", "card gap is 16px but should be 24px"
- Check: spacing/padding, font size/weight/line-height, colors (exact hex), alignment, border-radius, shadows, image sizing

## Accessibility (WCAG)
- **Target WCAG 2.1 AA compliance** on all pages, no exceptions.
- **Color contrast:** Text must meet minimum contrast ratios — 4.5:1 for normal text, 3:1 for large text and UI components.
- **Semantic HTML:** Use correct elements (`<nav>`, `<main>`, `<section>`, `<button>`, `<h1>`–`<h6>`, etc.). Never use a `<div>` where a semantic element fits.
- **Images:** Every `<img>` must have a descriptive `alt` attribute. Decorative images use `alt=""`.
- **Keyboard navigation:** All interactive elements must be reachable and operable via keyboard. Visible focus styles are required (`focus-visible`).
- **ARIA:** Use ARIA labels and roles where semantic HTML is insufficient (e.g. icon-only buttons, modals, custom components).
- **Forms:** Every input must have an associated `<label>`. Error messages must be programmatically linked.
- **Lighthouse check:** After implementation, run a Lighthouse audit in Chrome DevTools (Lighthouse tab → Accessibility). Aim for a score of **90+**. Fix any flagged issues before considering the task done.

## Output Defaults
- Single `index.html` file, all styles inline, unless user says otherwise
- Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Placeholder images: `https://placehold.co/WIDTHxHEIGHT`
- Mobile-first responsive

## Brand Assets
- Always check the `brand_assets/` folder before designing. It may contain logos, color guides, style guides, or images.
- If assets exist there, use them. Do not use placeholders where real assets are available.
- If a logo is present, use it. If a color palette is defined, use those exact values — do not invent brand colors.

## Anti-Generic Guardrails
- **Colors:** Never use default Tailwind palette (indigo-500, blue-600, etc.). Pick a custom brand color and derive from it.
- **Shadows:** Never use flat `shadow-md`. Use layered, color-tinted shadows with low opacity.
- **Typography:** Never use the same font for headings and body. Pair a display/serif with a clean sans. Apply tight tracking (`-0.03em`) on large headings, generous line-height (`1.7`) on body.
- **Gradients:** Layer multiple radial gradients. Add grain/texture via SVG noise filter for depth.
- **Animations:** Only animate `transform` and `opacity`. Never `transition-all`. Use spring-style easing.
- **Interactive states:** Every clickable element needs hover, focus-visible, and active states. No exceptions.
- **Images:** Add a gradient overlay (`bg-gradient-to-t from-black/60`) and a color treatment layer with `mix-blend-multiply`.
- **Spacing:** Use intentional, consistent spacing tokens — not random Tailwind steps.
- **Depth:** Surfaces should have a layering system (base → elevated → floating), not all sit at the same z-plane.

## Hard Rules
- Do not add sections, features, or content not in the reference
- Do not "improve" a reference design — match it
- Do not stop after one screenshot pass
- Do not use `transition-all`
- Do not use default Tailwind blue/indigo as primary color