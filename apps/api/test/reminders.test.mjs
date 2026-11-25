import test from 'node:test';
import assert from 'node:assert/strict';
import {nextOccurrence} from '../dist/notifications/reminder.service.js';
test('reminders advance to the first strictly future occurrence',()=>{
 const due=new Date('2026-11-01T10:30:00Z');
 assert.equal(nextOccurrence(due,3,due).toISOString(),'2026-11-04T10:30:00.000Z');
 assert.equal(nextOccurrence(due,3,new Date('2026-11-11T10:30:00Z')).toISOString(),'2026-11-13T10:30:00.000Z');
 assert.equal(nextOccurrence(due,3,new Date('2026-11-13T10:30:00Z')).toISOString(),'2026-11-16T10:30:00.000Z');
 assert.equal(nextOccurrence(due,3,new Date('2026-10-01T10:30:00Z')).toISOString(),due.toISOString());
});
test('invalid reminder schedules are rejected',()=>{
 for(const interval of [0,366,1.5,-1])assert.throws(()=>nextOccurrence(new Date(),interval,new Date()));
 assert.throws(()=>nextOccurrence(new Date('invalid'),1,new Date()));
});
