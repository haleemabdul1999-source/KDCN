const { execSync } = require('node:child_process');

module.exports = async () => {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://kdcn:kdcn@localhost:5432/kdcn_test';
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
};
