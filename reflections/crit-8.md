# Crit 8: It's alive!

_Draft built from what happened this week. Rewrite it in your own words before the
cutoff (Wed 7 Oct, 13:30). Part 2 especially is a starting point to confirm or
replace: only you can answer it._

## 1. What was the breakthrough that moved the work forward?

Writing the design statement before any code: a good virtual gym should make
individual training feel shared without turning exercise into a meeting,
competition or social feed. It became the yardstick for everything after it.

The clearest example came in the review pass. The first build showed everyone's
last set, weights included, on their label on the floor. It worked and looked
good, but held against the statement it was a quiet leaderboard. Taking the numbers
off the public floor was a one-line change in the query and a new check in
`spec/`. What it really changed was what the app *is*: you can see what someone's
doing, never how much. The same thing happened with the empty-gym view, which
looked like a diagram until each station showed open spots for people who aren't
there yet.

The technical breakthrough was the presence table: one row per person, rewritten on
every change. It's why coming back puts you where you were, with your rest timer
still running from the server's clock, and it's the shape the floor will need to
send once it updates live.

## 2. What did this work change about who I want to be as a software developer?

_Draft to confirm or replace:_ Most of my effort this week went into saying what
the app must **not** be, and then checking whether it had drifted. My two prompts
were mostly limits and a review brief, not feature requests, and the review found
real drift that passing tests had not: numbers in public, totals on the welcome
screen, labels that lied about where people rest. I want to be the developer who
treats "it works" as the start of the review, not the end, and who turns each
correction into a rule or a check so it can't drift back.
