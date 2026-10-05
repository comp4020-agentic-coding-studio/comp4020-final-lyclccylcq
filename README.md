# Virtual Gym

> A good virtual gym should make individual training feel like training alongside other people, without turning exercise into a meeting, a competition, or a social feed.

Virtual Gym (the gym itself is called Same Gym) is a persistent pixel-art gym on the web, where your real workout decides what your character is doing.

![The gym on desktop: you mid-set on a flat bench, others on the next bench and the incline, with the set panel in the corner](docs/gym.png)

## Why a gym, not a tracker

Most fitness apps record the result of training: sets, reps, weights, trends. That's useful, but it leaves out what a physical gym gives people who train on their own: other people working hard nearby. Most people in a gym never talk; they put headphones in and at most ask whether a machine is free. Even so, training among them feels different from training alone at home. I wanted to find out whether that feeling can exist online.

## What good means here

1. **The room comes first.** The main screen is a pixel-art gym larger than your screen, with reception, a locker room, cardio, cable and weight machines, benches, racks, lifting platforms and a stretching area. There's no dashboard beside it.
2. **What you do is what your character does.** You start at the entrance. You don't pick an exercise from a list: you tap a free machine, your character walks to it, and only then does its setup ask for what that machine measures (weight and reps, assistance for the assisted pull-up, minutes and level for cardio). Start set, and your character bench presses, deadlifts or climbs stairs. Finish set records what you actually did, and your character rests beside the machine until the next set.
3. **Presence without pressure.** Other people are shown on the machines they're using. Their name tags show the exercise and whether they're training or resting, but never their numbers, and nobody is ranked.
4. **The gym remembers you.** Come back tomorrow, or on another device with your gym pass, and you have the same locker and history.

## Now, and what's remembered

The design rests on keeping two kinds of state apart:

> The gym floor shows what is happening now. The locker preserves what you have done before.

Where you stand, which machine you're on and whether you're training or resting are live state, and they expire: an unfinished set is dropped unrecorded, and opening the gym afresh starts you at the entrance. Finished sets are kept on the server. You see them by walking to your own numbered locker and opening it: recent visits with their sets, your visits in the past week, and your heaviest lifts. Nobody else can open it. Putting history in a locker makes persistence a place you return to, not a profile page beside the game.

![The locker room: your character in front of locker 33, the locker open in the corner showing this visit's bench press set](docs/locker.png)

## Other people, honestly

Everyone in the gym appears in the same room, but as of when your page last loaded, you last did something, or you came back to the tab. It doesn't update live yet; real-time presence is the next step. After that come small, low-pressure gestures, such as a fist bump while someone rests. None exist yet.

## What I deliberately haven't built

No leaderboards, followers, chat, feeds, AI coaching, nutrition tracking, analytics or achievements. They aren't bad ideas, but none of them makes it feel more like other people are training in the same space, and several turn exercise into a performance.

## What I read or looked at

Gather's virtual offices were my reference for the scale of a shared room and the feeling of moving through it. I used none of their art, maps or code: every sprite here is drawn in code.

## Where it should end up

Not a workout tracker with a pixel map attached, but a gym: your real training decides what your character is doing, and other people being there gives the room its company and atmosphere.
