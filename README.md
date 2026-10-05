# Virtual Gym

> A good virtual gym should make individual training feel like training alongside other people, without turning exercise into a meeting, a competition, or a social feed.

Virtual Gym (the gym itself is called Same Gym) is a persistent pixel-art gym on the web, where your real workout decides what your character is doing.

![The gym on desktop: you mid-set on a flat bench, others on the next bench and the incline, with the set panel in the corner](docs/gym.png)

## Why I think this is worth building

Most fitness apps record the result of training: sets, reps, weights, trends. Training at home can reproduce most of a gym's practical side (equipment, plans, timers, tracking, coaching), but not the atmosphere of other people training nearby.

That atmosphere doesn't come from friendship or conversation. In a real gym people wear headphones and speak to a stranger only to ask whether a machine is free. Still, seeing others work hard, finish a set, rest and move on changes how you train: it brings motivation, some accountability, and the sense that effort is shared. You don't need to know them; it can be enough to know that someone else is here, working hard alongside me. I think this matters most to people who train alone or at home and want a gym's atmosphere without social obligation, and I want to test whether it can exist online.

## What good means here

If the point is atmosphere, a better version isn't one with more statistics, social features, gamification or AI, but one where you can feel that other people are training in the same space. Hence the principle above: *individual* training (you do your own workout) *alongside* others (their presence is the value), but not a meeting, competition or feed, each of which would replace atmosphere with obligation. Concretely, a good version lets you:

- see on walking in that this is a shared place, not a dashboard;
- tell at a glance who is on which machine, doing what, training or resting, without opening a profile or seeing anyone's numbers;
- train without ever being asked to talk;
- have your own workout show in the room: walk to a machine, start a set, and your character does the lift until you finish;
- leave and come back without losing anything you've done;
- feel the room get busier as more people come in.

## Now, and what's remembered

> The gym floor shows what is happening now. The locker preserves what you have done before.

Where you are and what you're doing is live state and expires: an unfinished set is dropped unrecorded, and a fresh visit starts at the entrance. Finished sets are kept on the server, and you see them by opening your own locker: recent visits, visits this past week, heaviest lifts. Nobody else can open it, so persistence becomes a place you return to rather than a profile page.

![The locker room: your character in front of locker 33, the locker open in the corner showing this visit's bench press set](docs/locker.png)

## Where it stands at crit 8

All of the above works except one thing: other people appear in the room, on their machines and showing what they're doing, but as of when your page last loaded, you last acted, or you returned to the tab. The room doesn't change live yet, so the last item above isn't met; real-time presence is the next step. After that I want to explore how little interaction strengthens presence without disturbing anyone's training, such as a fist bump while someone rests. No direct interaction exists yet.

## What I deliberately haven't built

No leaderboards, followers, chat, feeds, AI coaching, nutrition tracking, analytics or achievements. They aren't bad ideas, but none makes it feel more like others are training in the same space, and several turn exercise into a performance.

## What I read or looked at

Gather's virtual offices were my reference for the scale of a shared room and the feeling of moving through it. I used none of their art, maps or code: every sprite here is drawn in code.

## Where it should end up

Not a workout tracker with a pixel map attached, but a place where your real training decides what your character does, and other people being there gives the room its company and atmosphere. It's a test of whether training alongside others can exist online without demanding constant communication.
