# 10. Provide a portable itinerary output for mobile consultation

Recorded: 2026-11-07 (retrospective). Status: accepted; the chosen direction is implemented.

Private print/PDF and PNG/read-only export implemented on 2026-11-04; public itinerary export extended on 2026-11-06.

The personal rationale was supplied by the author during the Final documentation review. Code dates below identify implementation stages.

## Context and the author's reasons

### The plan needed an output I could actually carry on a trip

Near the end of the project, I noticed a substantial omission: the plan could be built in the website, but I had not given enough attention to its output. For me, the job was not finished when the itinerary looked complete inside the editor. I needed a convenient way to consult it while travelling.

This was connected to the users and habits I had in mind. In my Australian experience, I often encountered shops and restaurants through websites. My own preference, and the Chinese mobile-use habits I was designing around, leaned much more towards keeping something directly on a phone. Exporting the itinerary as an image, saving it and checking the phone's photo album during a trip would be convenient. That use mattered to me more than requiring the live planning interface to be open for every consultation.

I therefore added export as a genuine part of the planning workflow. The project supports a browser print/PDF route, a PNG image and a read-only link. An image provides a portable result of the plan, while the website remains the place to develop it together. The implementation also lets public itinerary pages export without first creating a private trip ([813f528](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/813f528fb793e08ae3c632fdc1e1fa0055b83dd4), [91c4e28](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/91c4e28c42a76b5484687573e48143877de29871), [48c1215](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/48c1215f7dc005ae3f7edc9249b0afcae5f8b0aa)).

Those outputs have different meanings. A downloaded image or PDF is a static result. A read-only export link shows the current itinerary, including notes. Publishing creates a separate snapshot, with different privacy and update rules. This record records why I added a portable output and the scope of these choices.

## Options and decision

- Requiring the live planning page for every consultation leaves the author's phone-album use case unsupported.
- PNG is chosen as a portable result that can be saved and consulted on the phone.
- Browser print/PDF provides another static output; a read-only link provides a view of the current plan.
- Export is available independently of publishing. A public snapshot, an edit invitation and an export link have different purposes and data exposure.

## Consequences and costs

Static output can become outdated after the shared itinerary changes. It must preserve readable titles, times and routes on a small screen. Chinese and wrapped titles require output checks as well as browser layout checks. A read-only export link contains notes and remains tied to the current itinerary, while a publication omits notes and changes only when republished. Those distinctions must be clear to the person sharing it.

The author describes personal habits and the Chinese users they had in mind. This record does not treat that experience as a market-wide study of every Chinese or Australian user.

## Record notes

The export decision concerns consulting the itinerary away from the editor. It does not add offline collaborative editing. Implementation and privacy details are maintained in [permissions.md](../../docs/permissions.md), with later output fixes in [acc4f83](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/acc4f836988d94af5c7dd198d586034ee5295272) and [9dfb7ab](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9dfb7ab418570c09a2a3e5a453fa07d9a2455366).
