FROM node:16-alpine

ENV DB_HOST=$DB_HOST

WORKDIR /usr/src/app
COPY . /usr/src/app

RUN npm install

EXPOSE 3000
CMD ["/bin/sh", "-c", "./w8_init_db.sh $DB_HOST npm start"]
#CMD ["npm", "start"]