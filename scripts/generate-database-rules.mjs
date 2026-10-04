// Generate the deployable RTDB rules without hand-copying security expressions.
// Run: node scripts/generate-database-rules.mjs
import { writeFileSync } from 'node:fs';

const auth = 'auth != null';
const owner = 'auth.uid == $uid';
const after = (depth) => 'newData' + '.parent()'.repeat(depth);
const path = (base, ...parts) => parts.reduce((expr, part) => `${expr}.child(${part})`, base);
const q = (value) => `'${value}'`;
const team = (base = 'root') => path(base, q('teams'), '$teamId');
const coach = (base = 'root') => `${team(base)}.child('coachUid').val()`;
const member = (base = 'root', user = '$uid') => path(base, q('members'), '$teamId', user);
const profile = (base = 'root', user = '$uid') => path(base, q('profiles'), user);
const link = (base = 'root') => `${profile(base)}.child('teamIds').child($teamId)`;
const reader = (base = 'root', coachId = coach(base)) => path(base, q('recordReaders'), '$uid', coachId, '$teamId');
const history = (base = 'root') => path(base, q('history'), '$teamId', '$uid');
const joined = `(${coach()} == auth.uid || ${member('root', 'auth.uid')}.exists())`;
const recordReader = `(auth.uid == $uid || root.child('recordReaders').child($uid).child(auth.uid).hasChildren())`;
const name = "newData.isString() && newData.val().length >= 1 && newData.val().length <= 60";
const date = "newData.isString() && newData.val().length <= 40 && newData.val().matches(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?Z$/)";
const code = "newData.isString() && newData.val().matches(/^[A-Z0-9]{6}$/)";
const tests = ['balance', 'reaction', 'eye', 'eyePhone'];
const testExpression = (value) => `(${tests.map((id) => `${value} == '${id}'`).join(' || ')})`;
const valueIn = (values) => `(${values.map((value) => `newData.val() == '${value}'`).join(' || ')})`;
const bounded = 'newData.isNumber() && newData.val() >= -1000000 && newData.val() <= 1000000';
const scalar = (validate) => ({ '.validate': validate });
const allowedObject = (required, children) => ({
  '.validate': required.length ? `newData.hasChildren(${JSON.stringify(required)})` : 'newData.hasChildren()',
  ...children,
  '$other': scalar(false),
});
const metricTests = {
  sway: ['balance'], singleSway: ['balance'], errors: ['balance'],
  medianMs: ['reaction'], spreadMs: ['reaction'], mistakes: ['reaction'],
  onTarget: ['eye', 'eyePhone'], gain: ['eye', 'eyePhone'], saccadeRate: ['eye', 'eyePhone'],
  lagMs: ['eye', 'eyePhone'], trackingError: ['eye', 'eyePhone'],
};
const metricRule = (ids) => `${bounded} && (${ids.map((id) => `newData.parent().parent().child('test').val() == '${id}'`).join(' || ')})`;
const conditions = allowedObject([], {
  rested: scalar('newData.isBoolean()'), heat: scalar('newData.isBoolean()'), pain: scalar('newData.isBoolean()'),
  place: scalar(valueIn(['quiet', 'sideline'])), light: scalar(valueIn(['indoor', 'shade', 'sun'])),
  device: scalar(valueIn(['phone', 'laptop'])),
});
const immutableTrialFields = [
  'subjectUid', 'testerUid', 'test', 'kind', 'at', 'teamId', 'status',
  ...Object.keys(metricTests).map((key) => 'metrics/' + key),
  ...['rested', 'heat', 'pain', 'place', 'light', 'device'].map((key) => 'conditions/' + key),
];
// Rules val() does not return objects. Compare every allowed scalar, including
// absent optional values, so outbox replays acknowledge without editing a result.
const identicalTrial = immutableTrialFields.map((key) => `newData.child('${key}').val() == data.child('${key}').val()`).join(' && ');
const checkTeam = "newData.child('teamId').val()";
const canCreateCheck = `newData.child('kind').val() == 'check' && newData.child('teamId').isString() && root.child('members').child(${checkTeam}).child($uid).exists() && (root.child('members').child(${checkTeam}).child(auth.uid).exists() || root.child('teams').child(${checkTeam}).child('coachUid').val() == auth.uid)`;
const trial = allowedObject(['subjectUid', 'testerUid', 'test', 'kind', 'at'], {
  subjectUid: scalar('newData.val() == $uid'),
  testerUid: scalar('newData.isString() && newData.val().length >= 1 && newData.val().length <= 128'),
  test: scalar(testExpression('newData.val()')),
  kind: scalar(valueIn(['baseline', 'check'])),
  at: scalar(date),
  teamId: scalar("newData.isString() && newData.val().length >= 1 && newData.val().length <= 128 && newData.parent().child('kind').val() == 'check'"),
  status: scalar(`${valueIn(['normal', 'monitor', 'refer', 'no-baseline'])} && newData.parent().child('kind').val() == 'check'`),
  metrics: allowedObject([], Object.fromEntries(Object.entries(metricTests).map(([key, ids]) => [key, scalar(metricRule(ids))]))),
  conditions,
});
trial['.validate'] += " && ((newData.child('kind').val() == 'baseline' && !newData.child('teamId').exists() && !newData.child('status').exists()) || (newData.child('kind').val() == 'check' && newData.hasChildren(['teamId', 'status'])))";
trial['.write'] = `${auth} && ((!newData.exists() && ${recordReader}) || (newData.exists() && ((!data.exists() && newData.child('testerUid').val() == auth.uid && ((auth.uid == $uid && newData.child('kind').val() == 'baseline' && root.child('profiles').child($uid).child('role').val() == 'athlete') || (${canCreateCheck}))) || (data.exists() && data.child('testerUid').val() == auth.uid && (${identicalTrial})))))`;

const profileAfter = after(4);
const memberAfter = after(3);
const aclAfter = after(4);
const unlink = (base) => `!${link(base)}.exists() && !${reader(base)}.exists() && !${history(base)}.exists()`;
const rules = {
  '.read': false,
  '.write': false,
  profiles: {
    '$uid': {
      '.read': `${auth} && ${owner}`,
      '.write': `${auth} && ${owner} && !data.exists() && newData.exists() && !newData.child('teamIds').exists()`,
      '.validate': "newData.hasChildren(['name', 'role']) && (!data.child('consentedAt').exists() || newData.child('consentedAt').val() == data.child('consentedAt').val())",
      role: scalar(`${valueIn(['coach', 'athlete'])} && (!data.exists() || newData.val() == data.val())`),
      name: { '.write': `${auth} && ${owner} && newData.exists()`, '.validate': name },
      consentedAt: { '.write': `${auth} && ${owner} && !data.exists() && newData.exists()`, '.validate': date },
      teamIds: {
        '$teamId': {
          '.write': `${auth} && ((newData.exists() && ${owner} && (${coach(profileAfter)} == $uid || (${member(profileAfter)}.exists() && ${reader(profileAfter)}.val() == true))) || (!newData.exists() && (${owner} || ${coach()} == auth.uid) && !${member(profileAfter)}.exists() && !${reader(profileAfter)}.exists() && !${history(profileAfter)}.exists()))`,
          '.validate': 'newData.val() == true && $teamId.length <= 128',
        },
      },
      '$other': scalar(false),
    },
  },
  teams: {
    '$teamId': {
      '.read': auth,
      '.write': `${auth} && !data.exists() && newData.exists() && root.child('profiles').child(auth.uid).child('role').val() == 'coach' && newData.child('coachUid').val() == auth.uid && ${after(2)}.child('profiles').child(auth.uid).child('teamIds').child($teamId).val() == true && ${after(2)}.child('joinCodes').child(newData.child('code').val()).child('teamId').val() == $teamId`,
      ...allowedObject(['name', 'coachUid', 'coachName', 'code', 'createdAt'], {
        name: scalar(name), coachUid: scalar('newData.isString() && newData.val() == auth.uid'),
        coachName: scalar(name), code: scalar(code), createdAt: scalar(date),
      }),
    },
  },
  joinCodes: {
    '$code': {
      '.read': auth,
      '.write': `${auth} && !data.exists() && newData.exists() && $code.matches(/^[A-Z0-9]{6}$/) && ${after(2)}.child('teams').child(newData.child('teamId').val()).child('coachUid').val() == auth.uid && ${after(2)}.child('teams').child(newData.child('teamId').val()).child('code').val() == $code`,
      ...allowedObject(['teamId'], { teamId: scalar('newData.isString() && newData.val().length >= 1 && newData.val().length <= 128') }),
    },
  },
  members: {
    '$teamId': {
      '.read': `${auth} && ${joined}`,
      '$uid': {
        '.read': `${auth} && ${owner}`,
        '.write': `${auth} && ((newData.exists() && !data.exists() && ${owner} && ${profile()}.child('role').val() == 'athlete' && ${link(memberAfter)}.val() == true && ${reader(memberAfter)}.val() == true) || (!newData.exists() && (${owner} || ${coach()} == auth.uid) && ${unlink(memberAfter)}))`,
        ...allowedObject(['name', 'code', 'joinedAt'], {
          name: scalar(name), code: scalar(`${code} && newData.val() == ${team()}.child('code').val()`), joinedAt: scalar(date),
        }),
      },
    },
  },
  recordReaders: {
    '$uid': {
      '.read': `${auth} && ${owner}`,
      '$coachUid': {
        '.read': `${auth} && auth.uid == $coachUid`,
        '$teamId': {
          '.write': `${auth} && ((newData.exists() && ${owner} && ${coach(aclAfter)} == $coachUid && ${member(aclAfter)}.exists() && ${link(aclAfter)}.val() == true) || (!newData.exists() && (${owner} || auth.uid == $coachUid) && ${coach()} == $coachUid && !${member(aclAfter)}.exists() && !${link(aclAfter)}.exists() && !${history(aclAfter)}.exists()))`,
          '.validate': 'newData.val() == true',
        },
      },
    },
  },
  trials: {
    '$uid': {
      '.read': `${auth} && ${recordReader}`,
      '.indexOn': ['at'],
      '$trialId': trial,
    },
  },
  avatars: {
    '$teamId': {
      '.read': `${auth} && ${joined}`,
      '$uid': {
        '.write': `${auth} && ((newData.exists() && ${owner} && ${joined}) || (!newData.exists() && (${owner} || ${coach()} == auth.uid)))`,
        ...allowedObject(['kind', 'updatedAt'], {
          kind: scalar(valueIn(['photo', 'dot', 'none'])),
          updatedAt: scalar(date),
          photo: scalar("newData.isString() && newData.val().length <= 120000 && newData.val().matches(/^data:image\\/jpeg;base64,[A-Za-z0-9+\\/=]+$/) && newData.parent().child('kind').val() == 'photo'"),
          dot: scalar(`${valueIn(['sunny', 'mint', 'sky', 'berry', 'grape', 'tangerine'])} && newData.parent().child('kind').val() == 'dot'`),
        }),
        '.validate': "newData.hasChildren(['kind', 'updatedAt']) && ((newData.child('kind').val() == 'photo' && newData.child('photo').exists()) || (newData.child('kind').val() == 'dot' && newData.child('dot').exists()) || (newData.child('kind').val() == 'none' && !newData.child('photo').exists() && !newData.child('dot').exists()))",
      },
    },
  },
  history: {
    '$teamId': {
      '.read': `${auth} && ${coach()} == auth.uid`,
      '$uid': {
        '.read': `${auth} && ${owner}`,
        '.write': `${auth} && ((newData.exists() && ${owner} && ${member(after(3))}.exists()) || (!newData.exists() && (${owner} || ${coach()} == auth.uid)))`,
        ...allowedObject(['concussions', 'adhd', 'vision', 'vestibular', 'updatedAt'], {
          concussions: scalar('newData.isNumber() && newData.val() % 1 == 0 && newData.val() >= 0 && newData.val() <= 20'),
          adhd: scalar('newData.isBoolean()'), vision: scalar('newData.isBoolean()'), vestibular: scalar('newData.isBoolean()'),
          updatedAt: scalar(date),
        }),
      },
    },
  },
  ranges: {
    '$teamId': {
      '.read': `${auth} && ${joined}`,
      '$rangeId': {
        '.write': `${auth} && ((newData.exists() && root.child('members').child($teamId).child(newData.child('subjectUid').val()).exists() && (newData.child('subjectUid').val() == auth.uid || ${coach()} == auth.uid)) || (!newData.exists() && (${coach()} == auth.uid || data.child('subjectUid').val() == auth.uid || $rangeId == auth.uid + '_balance' || $rangeId == auth.uid + '_reaction' || $rangeId == auth.uid + '_eye' || $rangeId == auth.uid + '_eyePhone')))`,
        ...allowedObject(['subjectUid', 'test', 'n'], {
          subjectUid: scalar('newData.isString() && (!data.exists() || newData.val() == data.val())'),
          test: scalar(testExpression('newData.val()')),
          n: scalar('newData.isNumber() && newData.val() % 1 == 0 && newData.val() >= 1 && newData.val() <= 1000'),
          limits: allowedObject([], Object.fromEntries(Object.entries(metricTests).filter(([key]) => key !== 'trackingError').map(([key, ids]) => [key, {
            ...allowedObject(['worse', 'limit'], { worse: scalar(valueIn(['higher', 'lower'])), limit: scalar(bounded) }),
            '.validate': `newData.hasChildren(['worse', 'limit']) && (${ids.map((id) => `newData.parent().parent().child('test').val() == '${id}'`).join(' || ')})`,
          }]))),
        }),
        '.validate': "newData.hasChildren(['subjectUid', 'test', 'n']) && $rangeId == newData.child('subjectUid').val() + '_' + newData.child('test').val()",
      },
    },
  },
};

writeFileSync(new URL('../database.rules.json', import.meta.url), JSON.stringify({ rules }, null, 2) + '\n');
