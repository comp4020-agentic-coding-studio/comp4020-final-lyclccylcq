# Crit 9: All at once

## 1. What was the breakthrough that moved the work forward?

The biggest step was replacing Virtual Gym with Wayline. The gym could show other people online, but I saw little room to design interaction beyond that, and I found it hard to say what the gym was for. A shared trip gives people something to act on together: one person's change shapes everyone's plan.

The second came once the project was real-time. I had assumed that more features and more information would make collaboration better. After adding the Google Maps API, the editor felt visually busy instead, with place icons, labels, routes and markers all competing with the plan. Real-time interaction needs the shared plan to stay readable, not just to arrive quickly. Next, I'll probably simplify what the map shows.

## 2. What did this work change about who I want to be as a software developer?

Adding real APIs made security concrete. Live collaboration on top of Google's services means API keys, and each key has to be stored somewhere safe. Wayline's keys live in a local `.env` file that git ignores and in Fly secrets. The server key never reaches the browser, and a check fails if it does. I want to be a developer who asks where secrets are stored, and who can see them, every time a new service is added, not after something leaks.

I also want to judge a feature by whether it makes the shared plan clearer, not by how much it adds.
