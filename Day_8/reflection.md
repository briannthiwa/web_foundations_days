# Reflection

**What was the most difficult concept in the course, and how did I overcome it?**

The hardest idea was consistency: how a system can be fast and still correct when many people use it at once. Caching, replicas and queues all add speed, but each means some users see slightly old data, and I struggled to decide where that is acceptable. I overcame it by tracing one request at a time through the cache, the primary database and the replica, and by putting real numbers on the load so every choice had a reason. My rule now is to be strict where a mistake costs money or trust, such as seat ownership, and relaxed where a few seconds of delay does not matter, such as browsing.

**Which part of my capstone would I improve, based on the feedback I received?**

I would improve the QuickNotes architecture document. My load estimates rested on untested assumptions, so I would explain where each number comes from and show how the design changes if one is wrong. I would also add failure cases, such as what happens when the cache or replica goes down, and rehearse my presentation so I can explain the trade-offs without reading my notes.

**What will I learn next?**

I want to build and run these systems for real: PostgreSQL in depth, authentication and security, and cloud deployment. I also want to try load testing, to measure how a design behaves under traffic instead of only calculating it.
