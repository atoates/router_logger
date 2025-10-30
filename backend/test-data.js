const axios = require('axios');

(async () => {
  const res = await axios.get('https://routerlogger-production.up.railway.app/api/routers');
  const router = res.data[0];
  
  console.log('Router data:');
  console.log(JSON.stringify(router, null, 2));
  
  const customFields = [];
  
  customFields.push({
    id: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
    value: router.router_id.toString()
  });
  
  if (router.imei) {
    const imeiNum = parseInt(router.imei);
    customFields.push({
      id: '8b278eb1-ba02-43c7-81d6-0b739c089e7c',
      value: imeiNum
    });
  }
  
  if (router.firmware_version) {
    customFields.push({
      id: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
      value: router.firmware_version
    });
  }
  
  if (router.last_seen) {
    const lastOnline = new Date(router.last_seen).getTime();
    customFields.push({
      id: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
      value: lastOnline
    });
  }
  
  let statusValue = router.current_status === 'online' ? 0 : 1;
  customFields.push({
    id: '8a661229-13f0-4693-a7cb-1df86725cfed',
    value: statusValue
  });
  
  const taskData = {
    name: router.name,
    custom_fields: customFields
  };
  
  console.log('\nTask data:');
  console.log(JSON.stringify(taskData, null, 2));
  
  console.log('\nTrying to create task...');
  try {
    const createRes = await axios.post(
      'https://routerlogger-production.up.railway.app/api/clickup/tasks/901517043586',
      taskData
    );
    console.log('✅ Success!', createRes.data.task.id);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
    console.log('Status:', error.response?.status);
  }
})();
