# Crit 10: Fly by instruments

## 1. What was the breakthrough that moved the work forward?

At Crit 9, I was trying to make two people see the same itinerary at once. For Crit 10, I realised that synchronisation was only half the problem. The server also needed to know who had done something, and whether that person was allowed to do it.

The clearest example was the sharing link. I first treated it as an invitation, but a link can be forwarded. Even a link that expires after 24 hours cannot tell me whether the person opening it is the person the owner meant to invite.

I changed the flow so a link only starts a request; the owner approves an identified account. I then made the owner/collaborator rules explicit on the server and added logs tied to the authenticated session.

Now an approval, an edit and a refused deletion can be attributed to different people rather than inferred from their browser screens.

## 2. What did this work change about who I want to be as a software developer?

I want to question what a working feature *assumes*. A link that opens the right page may still grant the wrong person access. A disabled button is not permission control. A live update is not enough if I cannot explain where it came from.

Working with a coding agent makes that responsibility more obvious. It can implement the workflow I describe quickly, but I have to notice when the workflow itself is inadequate, correct the rules, and ask for evidence beyond a green test run.

I want to build systems I can account for, not just demonstrate.
