# SnapShare: Scaling Plan

SnapShare is a photo-sharing app. Users upload photos and scroll a feed of photos from people they follow.

## 1. Assumptions

| Item | Value |
|---|---|
| Registered users | 10,000,000 |
| Daily active users (DAU) | 10% of registered = **1,000,000** |
| Uploads per active user per day | 1 photo |
| Feed page views per active user per day | 50 |
| Average original photo size | 2 MB |
| Thumbnail size | 50 KB (one per photo) |
| Seconds in a day | 86,400 |
| Peak traffic | 5x the average |

Extra assumptions I am making:
- One "feed view" is one request for a page of the feed (photo metadata plus thumbnail links). The images themselves are then fetched from the CDN.
- Traffic is spread evenly over the day for the average figure. The 5x peak covers busier hours such as evenings.
- Storage ignores database rows, backups and replication copies, which are tiny or can be added as a multiplier later.

## 2. Estimates

**Daily active users:** 10,000,000 x 10% = **1,000,000**

**Uploads per second**
- Uploads per day: 1,000,000 x 1 = 1,000,000
- Average: 1,000,000 / 86,400 = **about 12 uploads/s** (11.6)
- Peak (5x): **about 58 uploads/s**

**Feed views per second**
- Feed views per day: 1,000,000 x 50 = 50,000,000
- Average: 50,000,000 / 86,400 = **about 579 views/s**
- Peak (5x): **about 2,900 views/s** (2,894)

**Storage per year**
- Originals per day: 1,000,000 x 2 MB = 2 TB
- Thumbnails per day: 1,000,000 x 50 KB = 50 GB
- Total per day: about 2.05 TB
- Originals per year: 2 TB x 365 = 730 TB
- Thumbnails per year: 50 GB x 365 = about 18 TB
- **Total per year: about 748 TB (roughly 0.75 PB)**

Peak upload bandwidth is about 58 x 2 MB = 116 MB/s, roughly 1 Gbit/s, which is one more reason uploads should go straight to object storage instead of through our app servers.

## 3. Read-heavy or write-heavy?

**SnapShare is read-heavy.** There are 50 million feed views per day against 1 million uploads, a ratio of about **50 reads to 1 write**. (Each view also loads many thumbnails, so the real read load on images is higher still.)

What this means for the design:
- Optimise reads first: a **CDN** and a **cache** so most feed requests never reach the database.
- Add a **read replica** so feed queries do not compete with writes on the primary database.
- Keep the write path simple and make slow work (thumbnails) **asynchronous** with a queue, so uploads stay fast.
- Writes are still large in bytes (about 2 TB per day), so photo files need storage that scales cheaply: object storage.

## 4. Why photos are not stored in the database

Photo files should not go inside the database because:
- At about 750 TB per year, the database would become huge, slow to back up, slow to replicate and very expensive, since database disks cost far more per GB than object storage.
- Large binary blobs fill the database's memory and cache, pushing out the small, hot metadata rows that feeds depend on.
- Databases are not built to serve files over HTTP, so every image would have to pass through the database and app servers instead of being cached at the edge.

**Where they go instead:** photos live in **object storage** (such as Amazon S3 or Google Cloud Storage). The database stores only **metadata**: photo ID, owner, caption, upload time, status and the object storage key or URL. Images are served to users through the CDN.

## 5. Architecture diagram

```
                       +------------------+
                       |  Users (mobile / |
                       |   web browsers)  |
                       +--------+---------+
                                |
              images / thumbs   |   API requests (feed, upload, follow)
          +---------------------+----------------------+
          |                                            |
          v                                            v
   +-------------+                              +---------------+
   |     CDN     |                              | Load Balancer |
   | (edge cache)|                              +-------+-------+
   +------+------+                                      |
          | cache miss                      +-----------+-----------+
          |                                 |           |           |
          |                                 v           v           v
          |                           +---------+ +---------+ +---------+
          |                           |  App    | |  App    | |  App    |
          |                           | Server 1| | Server 2| | Server N|
          |                           +----+----+ +----+----+ +----+----+
          |                                |           |           |
          |            +-------------------+-----------+-----------+------+
          |            |                   |                  |            |
          |            v                   v                  v            v
          |      +-----------+   +------------------+  +-----------+ +-----------+
          |      |   Cache   |   |     Database     |  |   Queue   | |  Object   |
          |      | (Redis)   |   |                  |  | (thumbnail| |  Storage  |
          |      +-----------+   |  +------------+  |  |   jobs)   | | (photos & |
          |                      |  |  Primary   |  |  +-----+-----+ | thumbnails)|
          |                      |  |  (writes)  |  |        |       +-----+-----+
          |                      |  +-----+------+  |        v             ^
          |                      |        | copies  |  +-----------+       |
          |                      |        v         |  |  Worker   |-------+
          |                      |  +------------+  |  | (makes    | reads original,
          |                      |  | Read       |  |  | thumbnail)| writes thumbnail
          |                      |  | Replica    |  |  +-----+-----+
          |                      |  | (reads)    |  |        |
          |                      |  +------------+  |        | marks photo "ready"
          |                      +------------------+<-------+
          |                                                        
          +------------------- fetches files on miss ------------> Object Storage
```

Read paths in short:
- **Feed:** User -> Load Balancer -> App Server -> Cache (hit) or Read Replica (miss) -> response with thumbnail URLs.
- **Images:** User -> CDN -> (on miss) Object Storage.

## 6. What each component does (one sentence each)

- **CDN:** Serves photos and thumbnails from servers close to the user, which solves slow image loading and keeps most image traffic off our own servers.
- **Load balancer:** Spreads incoming requests across many app servers, which solves a single server being overwhelmed and removes it as a single point of failure.
- **App servers:** Run the application logic (login, feed, upload requests) and, being stateless, can be added or removed to handle more or less traffic, which solves the limit of one machine's capacity.
- **Cache:** Keeps recently built feeds and hot metadata in memory, which solves the problem of the database being hit by thousands of near-identical reads per second.
- **Database (primary):** Stores users, follows and photo metadata reliably and accepts all writes, which solves the need for consistent, structured data.
- **Read replica:** Holds a copy of the primary and answers read queries, which solves reads and writes competing on one database and adds a backup if the primary fails.
- **Object storage:** Stores the photo and thumbnail files cheaply and almost without limit, which solves the problem of storing about 750 TB a year that a database cannot handle well.
- **Queue:** Holds thumbnail jobs until a worker is free, which solves slow image processing blocking the upload request and absorbs spikes in uploads.
- **Worker:** Takes jobs from the queue, creates the 50 KB thumbnail and saves it, which solves the problem of heavy image processing slowing down the app servers.

## 7. Upload flow, step by step

1. The user picks a photo in the app and taps upload. The app sends a request to SnapShare's API.
2. The request reaches the **load balancer**, which forwards it to an **app server**.
3. The app server checks the user is logged in, validates the request (file type and size limit), and creates a photo row in the **primary database** with status `processing`.
4. The app server asks object storage for a **pre-signed upload URL** and returns it to the app.
5. The app uploads the 2 MB original **directly to object storage** using that URL, so the file never passes through our app servers.
6. Once the upload finishes, the app (or a storage event) tells the app server the upload is complete.
7. The app server puts a **"create thumbnail" job** (photo ID and storage key) on the **queue** and immediately tells the user the upload succeeded, so the user does not wait for thumbnail creation.
8. A **worker** picks up the job, downloads the original from object storage, resizes it to a 50 KB thumbnail, and saves the thumbnail back to object storage.
9. The worker updates the photo's row in the primary database to status `ready` with the thumbnail location. If it fails, the job goes back on the queue and is retried.
10. The new photo's ID is added to the cached feeds of the uploader's followers (or the cache is invalidated), so it appears when they next open the app.
11. When followers load their feed, the **CDN** serves the thumbnail, fetching it from object storage on the first request and caching it for everyone after.

## 8. Trade-offs

1. **Cache speed vs fresh data.** Caching feeds makes feed loads very fast and protects the database, but a cached feed can be slightly out of date, so a new photo may take a few seconds to appear. I accept this because a feed that is a few seconds old is fine for a photo app. Caching also adds a component that must be kept in sync and monitored.

2. **Read replica lag (eventual consistency).** The replica copies data from the primary with a small delay. A user who uploads and instantly reloads might not see their own photo from a replica. A fix is to read the user's own recent data from the primary, but that adds complexity. The benefit is that reads scale far beyond what one database can do.

3. **Asynchronous thumbnails vs instant availability.** Using a queue and worker keeps uploads fast and makes the system resilient to spikes, but the thumbnail is not ready immediately, so the photo briefly shows a placeholder and the system has an extra moving part (the queue, retries, failed jobs) to run.

4. **CDN and storage cost vs performance.** A CDN gives fast images worldwide and cuts load on our servers, but CDN bandwidth costs money, and cached images can be stale if a photo is deleted until the cache expires. Storing about 750 TB a year also costs a lot, so later I would move old, rarely viewed photos to cheaper storage tiers.

5. **Fan-out on write vs on read for feeds.** Pre-building each follower's feed when a photo is uploaded makes reading very fast, but a user with millions of followers causes a huge burst of writes. Building the feed at read time avoids that but is slower. A common compromise is to pre-build for normal users and compute at read time for very popular accounts.
