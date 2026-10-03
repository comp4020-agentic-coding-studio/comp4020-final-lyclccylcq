# Crit 8: It's alive!

_Draft. Rewrite in your own words before the cutoff (Wed 7 Oct, 13:30)._

## 1. What was the breakthrough that moved the work forward?

The idea came together when I split "a gym with other people in it" from "a
social fitness app". Once the design statement was written down (a good virtual
gym should make individual training feel shared without turning exercise into a
meeting, competition or social feed), most decisions answered themselves. Other
people are shown on the floor, not in a list. Others see only your current state,
not your history. There are no rankings. The same sentence is now the opening of
the README, the first rule in `CLAUDE.md`, and the reason the privacy check in
`spec/` exists.

On the technical side, the presence table was the key decision. Keeping one row
per person, rewritten on every change, made "come back and find yourself where
you were" fall out for free: the rest timer keeps counting from the server's clock
after a reload. It's also exactly the payload a live floor will need to send at
crit 9.

## 2. What did this work change about who I want to be as a software developer?

_To write yourself: the brief asks for your own position here, and it isn't
something the agent can supply._
