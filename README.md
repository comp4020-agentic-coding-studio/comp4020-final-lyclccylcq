# Same Gym

> A good virtual gym should make individual training feel shared without turning exercise into a meeting, competition, or social feed.

Same Gym is a small shared gym floor on the web. You walk in under a name and a
colour, pick a station (the cable stack, the bench, the squat rack, cardio, or the
stretch-and-rest area), and log your sets. Your dot stands at that station with what
you're doing on its label, for example "Lat Pulldown · 28.5 kg × 12 · Resting 01:20".
Anyone else in the gym stands at their own station in the same room.

![The gym floor on desktop, seeded locally with five test people: one resting at the cable stack, others at the bench, squat rack, cardio and rest area](docs/floor.png)

## Who it's for

It's for people who train alone, at home, in a quiet hotel gym or at odd hours, and
miss what a real gym gives you without anyone talking to you: other people working
hard nearby. It's sized for a handful of friends or one class of students, not for
thousands of strangers.

## The opportunity

Most fitness apps record what you did. A real gym also lets you feel who is training
alongside you. In a gym you notice the person on the next bench, see that someone is
resting between sets, and nobody turns it into a conversation. Apps that try to make
training social tend to add feeds, kudos, leaderboards or video calls. Those make
exercise into something to perform or to attend. Same Gym tries to keep just the
part of the room that matters: presence.

## What good means here

1. **The room comes first.** You see other people where they're training, on the
   floor itself, not in a list beside it. You know someone is there and what they're
   doing, and nothing more is asked of you.
2. **Logging stays out of the way.** Choose an exercise, enter a weight and reps,
   finish the set. Your last numbers for each exercise are already filled in.
3. **Your trace is still there.** Leave, refresh, or come back tomorrow on another
   device with your gym pass, and you're still you, with your visits and sets.
   A rest timer keeps running from the server's clock while you're away.
4. **Nobody is ranked.** No scores, no streaks, no public history of your sets.
   Other people see only your current exercise, your last set and whether you're
   resting.
5. **It works on a phone.** Phones are what people carry around a gym, so on a
   phone the floor becomes a compact map and the logging panel sits underneath.

## Why not a workout tracker

A tracker's main view is your history. Here the main view is the present: who is in,
where they're standing, who is between sets. Your history is kept, and it's there to
bring you back to your spot, not to be shown off.

## What I deliberately didn't build

No feeds, comments, direct messages, followers, rankings or achievements. No voice
or video. No AI coaching, workout plans or nutrition tracking. No password accounts:
a name, a colour and a gym pass are enough to tell people apart.

## Enforced and judged

The checks in `spec/` enforce: a new identity persists and the pass brings back
the same person; two people with the same name are still two people; a finished set
is still there on the next request and puts you at the right station; bad set data
is rejected and nothing is saved; the floor shows no one's pass; the page carries
every station without any script running. These things are judged by people, not by
tests: whether the room feels shared, whether the floor stays usable on a phone, and
whether logging feels lightweight.

## Not yet

Other people only appear when the page loads. Live updates are the next step.

## What I read or looked at

_To write: the sources that shaped this definition of good. The brief points at the
small web, games for a handful of friends and tools built for one workshop._
