Events shceduling tool

The tool allows participants to an event to schedule the event at a date/timeslot that is suitable to all.
1. Anyone having access can create an event (e.g. tennis match) and invite participants (e.g. players)
2. Invited participants receive the invitation and gain access to the tool
3. Any participant can suggest days/timeslot
4. The sugestions all appear on a shared calendar, with the number of parcicipants that can support the slots
5. A principle of voting decides upon teh final date/timeslot

Security:
the version in this repo will use test users configured in a config.json file. invitations will be simulated.
this repo will then be moved in the production sibling repo ../portal where invitations will be sent via email, and users are properly authenticated