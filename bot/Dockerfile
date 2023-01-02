FROM node:10-alpine

ENV DB_PASSWORD = $DB_PASSWORD
ENV TOKEN = $TOKEN

WORKDIR /usr/src/app
COPY . /usr/src/app

RUN npm install

EXPOSE 3000
CMD ["npm", "start"]