# 9. Develop a product identity while making further iteration maintainable

Recorded: 2026-11-07 (retrospective). Status: accepted; the chosen direction is implemented.

Early video/window work on 2026-10-20–23; module extraction on 2026-10-29; transit-line and later visual revisions from 2026-10-31 into November.

The personal rationale was supplied by the author during the Final documentation review. Code dates below identify implementation stages.

## Context and the author's reasons

### Taking ownership of the design also meant revisiting the code

At first I had given Claude considerable freedom over the visual design. I had not thought through that part of the product in much detail. Later, an evaluation using another model described the first version as generic and recognisably AI-designed. I took that criticism seriously. Even if the result was acceptable as a course prototype, I wanted to keep using and promoting this project after the course. I wanted a stronger design of my own.

Before continuing with more substantial optimisation and visual work, I was also concerned about what repeated additions and repairs had done to the code. This connected to the question I raised around Week 12: an agent can create a complete application, but maintaining and refactoring it may matter even more once it is actually used. Each new function or repair could leave structure and redundancy that were hard for me to see clearly.

I therefore asked for a broader restructuring before continuing the next round of development. The repository shows request logging, planning orchestration and sharing extracted from the larger modules, with tests preserving existing behaviour ([dfce3ef](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/dfce3ef853434c8d07d79f855dc1daba4a51d119)). That did not mean the whole application had been rewritten or every possible redundancy removed. It was a concrete step towards making later changes and maintenance more manageable. This record connects this decision to the subsequent visual work.

### Giving the homepage a travel view and the product its own language

I wanted the homepage to give a sense of travelling. My earlier ideas involved a stream of travel videos or photographs, like a vlog. The homepage experimented with video and then an automatic window journey in October ([470c01b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/470c01b5ac451d73bbe2778036263ea86420d092), [83a1517](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/83a151791e30668c794620e7fa99933fa7c9e0b2)). I found the view through a train window a particularly good fit: a carousel of changing scenery could express travel in a way that was interesting and visually appealing.

That idea still needed judgement after implementation. I reported that the window looked more like a picture frame, that the transitions were inconsistent, and that the movement did not feel equally convincing across scenes. Added trackside animations then looked too artificial beside the photographs. I asked for those effects and the heavy differences around the frame to be reconsidered; the later version removed the drawn foreground and used restrained movement and consistent transitions ([76a05ff](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/76a05ff54fe40f13fd25f3a2c3daf58cd58cafe5)).

After the structural work, I returned to larger homepage and visual-system revisions. The homepage developed over several rounds: the early video/window experiments preceded the 29 October module extraction, while the transit-line system and further homepage changes followed it.

The original typography and layout lacked a product identity. I wanted the page to feel like Wayline, not just another website with a different topic. I chose a language resembling a metro network, using routes and stations to emphasise the meaning of a journey. That idea carried into the itinerary, homepage and other screens ([e945d13](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/e945d1354537723aa19d172a1c29b8bbecf097f0), [d2476c7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/d2476c7b229990ca2dca86fdfa4f5bd8b372f775), [0b21109](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0b21109354401066a91db8898902ec79d0ce41fe)).

The window idea was inspired by short AI-made scenery videos I had recently seen. The metro-style route animation took its reference from metro systems themselves.

### Finishing the experience and deciding what not to add

Once the broader direction was in place, I continued refining details through multi-user testing. This included the registration and sign-in experience, the collaboration workflow and bugs that appeared while people used it. I added an English/Chinese switch for my own needs. I also wanted My Trips removed from the homepage, keeping personal trips in the dedicated personal trip/account area rather than repeating them in the discovery page.

The dedicated trips page already existed; removing its duplicate homepage section was a later step. Language support went beyond a translated heading: the account preference, interface, itinerary content and provider responses needed to agree. The implementation records include the language work, sign-in revisions and later homepage separation ([6ea712b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/6ea712bfa9eb68aa12074bc7c57743c3a9662c41), [4030c72](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/4030c7297caeffb80581d3a413ded0ce93d5ae2c), [0103b4f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0103b4fe6f9c11fb05c5f31fff7253811ac68e66), [48c1215](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/48c1215f7dc005ae3f7edc9249b0afcae5f8b0aa)).

I also considered a day/night mode and chose not to add it. I thought a dark version would substantially disrupt the visual design I had established. I was designing a travel-planning website rather than a long-running work environment, and I did not see enough value in maintaining a second visual system for prolonged-use preferences within this version's scope. That was my judgement about the intended use and design cost.

Feedback at a later crit also exposed serious problems at different browser proportions. I corrected those layout issues rather than treating the intended screenshots as sufficient. The history records fixes for browser zoom, short viewports and the subsequent editor layout ([8179106](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/817910610e48122e6b11e7acee1ad16cbdcb8b08), [0b21109](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0b21109354401066a91db8898902ec79d0ce41fe)). This record records the visual and scope choices.

## Options and decision

- Keeping the first autonomous visual result would reduce further work, but did not meet the author's intended identity for a product to use and promote beyond the course.
- Continuing to add features without revisiting module structure would leave the author's maintainability concern unresolved. The chosen structural work extracted responsibilities while protecting existing behaviour.
- Travel video and photo streams were explored. The train-window view was chosen for its connection to travelling; unrealistic drawn foreground effects were later removed.
- The transit-network language uses routes and stations to express the product's subject, rather than treating the theme as decoration.
- A dark mode was considered and not adopted. The author judged the extra visual system poorly matched to the established design and the intended use of this web version.

## Consequences and costs

A custom visual language requires the author to make judgements and reject implemented work. It also creates consistency work across the homepage, editor, sign-in and personal areas. Refactoring needs regression coverage and explicit boundaries, not just smaller files. The implemented extraction is narrower than a claim that all code was rewritten or all redundancy removed.

Keeping a light design saves a second theme's maintenance, but does not satisfy every user's possible visual preference. Responsive behaviour remains necessary: the design must work when browser size or zoom changes. Personal bilingual needs also add language and output-layout work.

## Record notes

The author referred to later layout feedback as Crit 11. This record uses "a later crit" without assigning it an unverified official session number or date. The concrete zoom/layout fixes are linked separately. Video/window experimentation started before the October module extraction; larger visual revisions continued afterwards.
