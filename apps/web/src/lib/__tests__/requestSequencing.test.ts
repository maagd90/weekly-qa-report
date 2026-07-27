import assert from 'node:assert/strict';
import { isCurrentDateRequest, isCurrentProjectRequest } from '../requestSequencing.ts';

// Out-of-order project switch: user picks project B then A quickly; A's
// response resolves first (sequence 2), then B's stale response (sequence 1)
// arrives later and must be dropped so it cannot clobber the current project.
assert.equal(
  isCurrentProjectRequest({ sequence: 2, project: 'A' }, { sequence: 2, project: 'A' }),
  true,
  'the response matching the latest sequence and active project must apply',
);
assert.equal(
  isCurrentProjectRequest({ sequence: 1, project: 'B' }, { sequence: 2, project: 'A' }),
  false,
  'a stale response from an earlier sequence must not apply',
);
assert.equal(
  isCurrentProjectRequest({ sequence: 2, project: 'B' }, { sequence: 2, project: 'A' }),
  false,
  'a response for a project the user has since navigated away from must not apply even with a matching sequence',
);

// Out-of-order date range apply: switching tabs or re-applying dates before a
// prior request resolves must not let the older response paint the wrong tab.
assert.equal(
  isCurrentDateRequest({ sequence: 3, project: 'A', tab: 'testers' }, { sequence: 3, project: 'A', tab: 'testers' }),
  true,
  'the response matching sequence, project, and tab must apply',
);
assert.equal(
  isCurrentDateRequest({ sequence: 2, project: 'A', tab: 'testers' }, { sequence: 3, project: 'A', tab: 'testers' }),
  false,
  'a stale date-range response must not apply',
);
assert.equal(
  isCurrentDateRequest({ sequence: 3, project: 'A', tab: 'cycles' }, { sequence: 3, project: 'A', tab: 'testers' }),
  false,
  'a response for a tab the user has since navigated away from must not apply',
);
assert.equal(
  isCurrentDateRequest({ sequence: 3, project: 'B', tab: 'testers' }, { sequence: 3, project: 'A', tab: 'testers' }),
  false,
  'a response for a project the user has since navigated away from must not apply',
);

console.log('Request sequencing race-guard tests passed');
