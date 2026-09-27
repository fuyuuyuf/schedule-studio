export async function activate(context) {
  context.log.info('示例插件已启动');
  const stopListening = context.events.on('schedule.created', schedule => {
    context.storage.set('lastCreatedScheduleId', schedule.id);
  });

  context.http.register('GET', 'status', () => ({
    message: '示例插件运行正常',
    scheduleCount: context.schedules.list().length,
  }));

  return () => {
    stopListening();
    context.log.info('示例插件已停止');
  };
}
