# AGENTS.md

How work is done in this repository, for the agents working in it. `README.md` says what the extensions
are, `CONTRIBUTING.md` how to run them and their tests; this is only what an agent gets wrong without it.

**A card is settled once the user answers or dismisses it.** A typed answer that asks something back
("explain better") is a request, not a decision: answer it, and ask the decision again in a new card. What
says whether a card still waits is the open list (`board.open`, the Inbox) — never a memory of having
asked. A card reported as open without reading the open list is a misreading, not a delivery failure, and
the search for a failure that never happened takes the conversation.
