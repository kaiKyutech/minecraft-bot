const {connect}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');
process.env.LOG_LEVEL='error';
(async()=>{
 const bot=await connect('flat','VisionChild03'),api=createBotApi(bot,{logLevel:'error'}),puppeteer=require('puppeteer'),launch=puppeteer.launch;let pid;
 puppeteer.launch=async options=>{const b=await launch(options);pid=b.process().pid;return b};
 const result=await api.startVision({renderWait:500});if(!result.ok)throw new Error(result.error.message);
 process.on('message',message=>{if(message==='terminate')process.emit('SIGTERM')});process.send({pid});
})().catch(e=>{console.error(e);process.exit(1)});
