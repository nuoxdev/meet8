# Desk8 Connect extraction and parity

Meet8 copies and adapts the meeting surface, not the entire Desk8 employee application.

| Capability                                                               | Meet8 state                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| LiveKit video/audio conference grid and focused screen share             | Adapted from Connect guest App.tsx                          |
| Device selection: microphone, camera, speaker                            | Copied GuestCallTools.tsx                                   |
| Noise cancellation and RNNoise processor                                 | Copied packages/call-audio, including notices               |
| Background blur and fullscreen shared screen                             | Copied GuestCallTools.tsx                                   |
| Screen sharing, mute, camera toggles                                     | Existing LiveKit conference controls retained               |
| Scheduling and reusable meeting URLs                                     | Adapted behavior with independent storage and organizations |
| Server-backed meeting chat                                               | Adapted behavior with per-session access enforcement        |
| Raise hand, participant list, host removal                               | Implemented against organization/session authorization      |
| End for everyone and explicit restart                                    | Implemented; session/room identity changes on restart       |
| Pre-join branding, owner provisioning, delegated managers                | New Meet8 features                                          |
| Invite-only verified email access                                        | New Meet8 security boundary                                 |
| Private Egress recording, saved details, expiring/revocable sharing      | Implemented; actual capture/playback verified               |
| English/Arabic UI, company portals, live policies and co-host moderation | Implemented with API/SFU enforcement                        |
| Transcript, AI summaries and live speech translation                     | Not yet extracted                                           |
| Host microphone mute / mute attendees                                    | Implemented; no remote device activation                    |
| Chat files / request-to-unmute workflow                                  | Not yet extracted                                           |
| Employee directory, office channels, internal direct calls               | Outside standalone client meeting scope                     |
| Landline/SIP, call agent, HR/CRM/tracking integrations                   | Outside standalone meeting scope                            |

The advanced meeting features above are a remaining parity phase. Do not describe the entire Connect feature set as migrated. This first version establishes the independent application and core meeting flow.
