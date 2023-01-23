# telegram-bot
Telegram bot for shoping 

Create a file '.env' in the root directory and fill it with the following content.
```
TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'
DB_PASSWORD = 'PASSWORD_FOR_DB_USER_telbot'
ROOT_POSTGRES_USER = 'ROOT_USER_FOR_DATABASE'
ROOT_POSTGRES_PASSWORD = 'PASSWORD_FOR_ROOT_DB_USER'
```

Then run the docker compose, the bot should work
```
docker-compose up
```
