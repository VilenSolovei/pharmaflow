import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
try{console.log(JSON.stringify(await app.get(OutboxDispatcher).run()));}finally{await app.close();}
