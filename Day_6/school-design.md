# Day 6: School Database Design

## Tables

**students** stores one row per student: a `student_id` (primary key), their `name` and their `email`. The email is `NOT NULL` and `UNIQUE` so no two students can share an address and every student can be contacted.

**courses** stores one row per course: a `course_id` (primary key), a `title` and the number of `credits` (checked to be greater than 0). A course exists independently of who is taking it.

**enrolments** stores one row per student-on-course: its own `enrolment_id` (primary key), a `student_id` and `course_id` (both foreign keys, both `NOT NULL`) and a `grade`. The grade is nullable because it is unknown until the course is marked. A `UNIQUE (student_id, course_id)` constraint stops the same student enrolling on the same course twice.

## Relationships

- **students to enrolments is one-to-many**: one student can have many enrolments, but each enrolment belongs to exactly one student.
- **courses to enrolments is one-to-many**: one course can have many enrolments, but each enrolment belongs to exactly one course.
- **students to courses is many-to-many**: a student takes many courses and a course has many students.

A relational table cannot hold a list of values in a single column, so storing course IDs inside `students` (or student IDs inside `courses`) would break the rules of normalisation and make queries painful. A **join table** solves this: `enrolments` turns one many-to-many relationship into two one-to-many relationships. It also gives a natural home for data that belongs to the *pairing* rather than to either side, such as the grade.

## Index

I would add an index on `enrolments(course_id)`:

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments(course_id);
```

The `UNIQUE (student_id, course_id)` constraint already creates an index that helps lookups by student, but it does not help when searching by course alone. Queries like "all students on one course" and "number of students per course" filter or group on `course_id`, so without this index the database would scan the whole table as it grows.

## SQL or NoSQL?

I would choose SQL for this system. The data is clearly structured and relational: students, courses and enrolments have fixed fields and well-defined links between them. Foreign keys and unique constraints let the database itself guarantee integrity (no enrolment for a student who does not exist, no duplicate enrolments), and JOINs make questions like "who is on this course?" or "who has no enrolments?" simple to answer. A school also needs consistent, transactional updates, for example when recording grades. NoSQL would be a better fit if the data were unstructured, changed shape constantly or had to scale across many servers, and none of that applies here.
