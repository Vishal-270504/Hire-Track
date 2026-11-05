/**
 * Ready-made hiring plans. Each round uses the round types the engine understands:
 *   ONLINE_TEST  pass by percentage        SCORECARD   pass by average of 1-5 skill scores
 *   TAKE_HOME    pass by average (1-5)     DECISION    hire / no-hire by the interviewer
 *   FINAL_APPROVAL  last step only, decided by a named HR approver
 */
export const ROUND_TEMPLATES = [
  {
    id: 'sde2-standard',
    name: 'Standard Java developer (SDE-2), five rounds',
    description: 'The plan from the hiring process: online test, two technical rounds, managerial, HR.',
    rounds: [
      {
        name: 'Online assessment', type: 'ONLINE_TEST', durationMin: 60, who: 'Automatic',
        format: 'HackerRank, Codility or in-house test', passPercent: 60,
        skills: ['2 coding problems in Java', '15 to 20 multiple-choice questions on Core Java, OOP, Collections and SQL'],
      },
      {
        name: 'Technical interview 1', type: 'SCORECARD', durationMin: 60, who: 'Senior Java developer',
        format: 'Video call with live coding', passAverage: 3,
        skills: ['Core Java and OOP', 'Collections and streams', 'Multithreading', 'JVM memory and GC', 'Coding problem'],
      },
      {
        name: 'Technical interview 2', type: 'SCORECARD', durationMin: 75, who: 'Tech lead or architect',
        format: 'Video call or in person', passAverage: 3,
        skills: ['Spring Boot and REST', 'JPA, Hibernate and SQL', 'Microservices', 'System design', 'Code review'],
      },
      {
        name: 'Managerial round', type: 'DECISION', durationMin: 45, who: 'Engineering manager',
        format: 'Discussion', skills: ['Ownership', 'Problem solving', 'Teamwork', 'Handling deadlines and conflict'],
      },
      {
        name: 'HR round', type: 'FINAL_APPROVAL', durationMin: 30, who: 'HR business partner',
        format: 'Discussion', skills: ['Culture fit', 'Career goals', 'CTC and notice period', 'Joining date'],
      },
    ],
  },
  {
    id: 'lean-three',
    name: 'Lean: three rounds',
    description: 'For junior or fast-moving roles. One technical round, one managerial decision, HR.',
    rounds: [
      {
        name: 'Technical interview', type: 'SCORECARD', durationMin: 75, who: 'Senior Java developer',
        format: 'Video call with live coding', passAverage: 3,
        skills: ['Core Java and OOP', 'Spring Boot and REST', 'SQL', 'Coding problem'],
      },
      {
        name: 'Managerial round', type: 'DECISION', durationMin: 45, who: 'Engineering manager',
        format: 'Discussion', skills: ['Ownership', 'Teamwork', 'Communication'],
      },
      {
        name: 'HR round', type: 'FINAL_APPROVAL', durationMin: 30, who: 'HR business partner',
        format: 'Discussion', skills: ['Culture fit', 'CTC and notice period', 'Joining date'],
      },
    ],
  },
  {
    id: 'senior-takehome',
    name: 'Senior: take-home first',
    description: 'For senior roles. A 48-hour take-home replaces the online test, then design and managerial rounds.',
    rounds: [
      {
        name: 'Take-home assignment', type: 'TAKE_HOME', durationMin: null, who: 'Two reviewers',
        format: 'Build a small REST API with Spring Boot and tests. 48 hours.', passAverage: 3,
        skills: ['Design and structure', 'Test quality', 'Code clarity'],
      },
      {
        name: 'Technical design interview', type: 'SCORECARD', durationMin: 75, who: 'Tech lead or architect',
        format: 'Video call', passAverage: 3,
        skills: ['Spring Boot and REST', 'Microservices', 'System design', 'Code review'],
      },
      {
        name: 'Managerial round', type: 'DECISION', durationMin: 45, who: 'Engineering manager',
        format: 'Discussion', skills: ['Ownership', 'Problem solving', 'Handling conflict'],
      },
      {
        name: 'HR round', type: 'FINAL_APPROVAL', durationMin: 30, who: 'HR business partner',
        format: 'Discussion', skills: ['Culture fit', 'Career goals', 'CTC and notice period'],
      },
    ],
  },
];

export const findTemplate = (id) => ROUND_TEMPLATES.find((t) => t.id === id);
