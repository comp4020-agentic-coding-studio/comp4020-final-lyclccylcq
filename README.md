# Virtual Gym

> A good virtual gym should make individual training feel like training alongside other people, without turning exercise into a meeting, a competition, or a social feed.

Virtual Gym (the gym itself is called Same Gym) is a persistent pixel-art gym on the web, where your real workout decides what your character is doing.

![The gym on desktop: you mid-set on a flat bench, others on the next bench and the incline, with the set panel in the corner](docs/gym.png)

## Why I think this is worth building

Most fitness apps record the result of training. Home training can reproduce a gym's equipment and plans, but not the atmosphere of others training nearby, which needs no conversation. In a real gym people wear headphones and speak only to ask whether a machine is free, yet seeing others work hard and rest changes how you train. It can be enough to know that someone else is here, working hard alongside me. That matters most to people who train alone, and I want to test whether it can exist online.

## What good means here

So a better version isn't one with more statistics, social features or gamification, but one where you can feel others training in the same space: *individual* training *alongside* others, never a meeting, competition or feed, each of which turns presence into obligation. A good version lets you:

- see on walking in that this is a shared place, not a dashboard;
- tell at a glance who is on which machine and what they're doing, without profiles or anyone's numbers;
- train without ever being asked to talk;
- see your own workout in the room: walk to a machine, Start set, and your character lifts until you Finish;
- leave and come back without losing what you've done;
- feel the room change as other people come and go.

## Now, and what's remembered

> The gym floor shows what is happening now. The locker preserves what you have done before.

Where you are and what you're doing expires: an unfinished set is never recorded, and a fresh visit starts at the entrance. Finished sets are kept on the server, and you read them in your own locker (recent visits, your past week, heaviest lifts), which nobody else can open. Persistence becomes a place, not a profile page.

![The locker room: your character in front of locker 33, the locker open in the corner showing this visit's bench press set](docs/locker.png)

## Where it stands at crit 8

Several people already share one gym, each shown on their machine with their exercise and state, but a browser only sees others as of its last load, action or return to the tab. So the last item above isn't met yet: real-time updates are crit 9. Then I'll explore how little direct interaction (a fist bump while someone rests) strengthens presence without disturbing training. None exists yet.

## What I deliberately haven't built

No leaderboards, followers, chat, feeds, AI coaching, nutrition or analytics. None is a bad idea, but none makes it feel more like others are training in the same space.

## What I read or looked at

- [Gather's virtual offices](https://www.gather.town/virtual-office): a persistent shared room where you see at a glance who is around. I took its sense of presence, not its art or code.
- Rhea, Landers, Alvar & Arent (2003), ["The effects of competition and the presence of an audience on weight lifting performance"](https://pubmed.ncbi.nlm.nih.gov/12741867/), *Journal of Strength and Conditioning Research* 17(2). Lifters pressed more with an audience or in competition than when simply lifting alongside each other: the social setting measurably changes effort. It doesn't show that quiet co-presence helps; that is the open question here.

## Where it should end up

Not a workout tracker with a pixel map attached, but a place where your real training decides what your character does, and other people give the room its atmosphere without demanding conversation.
