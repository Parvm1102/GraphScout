---
name: scout-viz
description: Design system and motion standards for the Graph Scout tactics app. Use whenever
  building, editing, or reviewing ANY UI component, page, chart, SVG, or animation in this
  project — even if the task doesn't mention design. Also use when writing landing-page copy.
---

# Identity
Dark broadcast-analytics look: near-black green-tinted background (#07120B), chalk-white pitch
lines at 40% opacity, one team color per side as the only saturated hues, amber (#F59E0B)
reserved exclusively for agent/optimizer actions. Typography: Inter or Geist; ALL numbers use
font-variant-numeric: tabular-nums. Forbidden: purple gradients, glassmorphism cards, emoji in
UI, stock illustrations, lorem ipsum, auth/signup/login/settings pages.

# Pitch canvas (core component)
SVG viewBox="0 0 120 80" — StatsBomb coordinates map 1:1; never hardcode pixels. Players =
circles, radius ∝ composite score, jersey number as label, placed at avg position. Passes =
curved quadratic paths, stroke-width ∝ count, arrowhead at target, color encodes progressive
share. Ball flow = small particles animating along edge paths, density ∝ volume. Simulation
states: suppressed player fades to 30% opacity with an amber leash-line to his presser; a cut
lane flashes red, then dims; rerouted edges thin/thicken via spring. The before→after diff must
read as a continuous animation, never a jump cut.

# Motion rules
In-app animation: Framer Motion only; animate on DATA CHANGE, never looping decoration.
200–350 ms for UI state, 600–900 ms staggered for network transitions, springs for layout.
Landing page only: GSAP + ScrollTrigger + Lenis. Animate transforms/opacity only (60 fps);
respect prefers-reduced-motion. Every changing number animates via count-up ticker.

# Landing page (built last)
Four pinned scroll-scrubbed scenes: (1) hero — pitch assembles from particles, headline types
on; (2) problem — a raw event table morphs into the clean graph; (3) scrolling scrubs a
suppression before/after on the pitch; (4) CTA into the live app. StatsBomb credit in footer.
