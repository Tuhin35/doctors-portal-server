const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const jwt = require('jsonwebtoken');
require('dotenv').config()

const stripe = require("stripe")(process.env.STRIPE_SECRET)
const port = process.env.PORT || 5000;

const app = express();
// middleware
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uidhp96.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri)
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function verifyJWT(req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send('unauthorized access')
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbidden access" })
    }
    req.decoded = decoded;
    next();
  })
}


async function run() {
  await client.connect();
  try {
    const appointmentOptionsCollection = client.db('doctorsPortal').collection('appointmentOptions');
    const bookingsCollections = client.db('doctorsPortal').collection('bookings');
    const usersCollections = client.db('doctorsPortal').collection('users');
    const doctorsCollections = client.db('doctorsPortal').collection('doctors');
    const paymentCollections = client.db('doctorsPortal').collection('payment');
    
     const verifyAdmin = async(req,res,next) =>{
      // console.log('inside verifyAdmin', req.decoded.email);
      const decodedEmail = req.decoded.email;
      const query = {email: decodedEmail};
      const user = await usersCollections.findOne(query);
      if(user?.role !=='admin'){
        return res.status(403).send({message:'forbidden access'})
      }
      next();
     }

    app.get('/appointmentOptions', async (req, res) => {
      const date = req.query.date;
      // console.log(date)
      const query = {}
      const cursor = appointmentOptionsCollection.find(query);
      const options = await cursor.toArray();
      const bookingQuery = { appointmentDate: date }
      const alreadyBooked = await bookingsCollections.find(bookingQuery).toArray();
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
        const bookSlots = optionBooked.map(book => book.slot)
        const remainingSlots = option.slots.filter(slot => !bookSlots.includes(slot))
        option.slots = remainingSlots;
        // console.log(date,option.name , bookSlots)
      })
      res.send(options)
    })
    /* 
    API naming convention
    booking
    *app.get('/bookings') bookings sob data dekte 
    *app.get("/bookings/:id") booking r id onojai data dekte
    * app.post("bookings") booking e new data add 
    *
    
    
    */
    app.post('/bookings', async (req, res) => {
      const booking = req.body;

      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }
      const alreadyBooked = await bookingsCollections.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `you already have a booking on ${booking.appointmentDate}`
        return res.send({ acknowledged: false, message })

      }

      const result = await bookingsCollections.insertOne(booking);
      res.send(result)
    })

    app.get('/bookings/:id',async(req,res)=>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const booking = await bookingsCollections.findOne(query);
      res.send(booking)
    })





    //  email unojai data  
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access  ' })
      }

      const query = { email: email };
      const cursor = bookingsCollections.find(query)
      const bookings = await cursor.toArray();
      res.send(bookings)
      //  console.log(bookings)
    });

    // Payment Gateway
    app.post('/create-payment-intent',async(req,res)=>{
      const booking = req.body;
      const price = booking.Price;
      const amount = price* 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency : 'usd',
        amount : amount,
        "payment_method_types":[
          "card"
        ]
      })
      res.send({
        clientSecret: paymentIntent.client_secret,
      })

    })




    // jwt token
    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollections.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '4h' })
        return res.send({ accessToken: token });
      }
      // console.log(user)
      res.status(403).send({ accessToken: '' })
    })

    // load All Data 
    app.get('/users', async (req, res) => {
      const query = {};
      const users = await usersCollections.find(query).toArray();
      res.send(users)


    })

    // save user data
    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await usersCollections.insertOne(user);
      res.send(result)
    })
    // check admin
    app.get('/users/admin/:email',async(req,res)=>{
      const email= req.params.email;
      const query = {email}
      const user = await usersCollections.findOne(query);
      res.send({isAdmin: user?.role ==='admin'})
    })


    // make admin
    app.put('/users/admin/:id',verifyJWT, verifyAdmin, async (req, res) => {
     
      const id = req.params.id;

      const filter = { _id: new ObjectId(id) }
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollections.updateOne(filter, updatedDoc, options);
      res.send(result)
    })
    // temporary update price
    // app.get('/addPrice',async(req,res)=>{
    //   const filter = {};
    //   const options = {upsert: true}
    //   const updatedDoc = {
    //     $set: {
    //       Price: 400
    //      }
    //   }
    //   const result = await appointmentOptionsCollection.updateMany(filter,updatedDoc,options)
    //   res.send(result)
    //   // console.log(result)
    // })

// Doctor Add 
 app.get('/appointmentSpecialty', async(req,res)=>{
  const query = {}
  const result = await appointmentOptionsCollection.find(query).project({name:1}).toArray();
  res.send(result)


 })

//  doctors api
// find all doctors
app.get('/doctors',verifyJWT, verifyAdmin, async(req,res)=>{

  const query = {};
  const doctors = await doctorsCollections.find(query).toArray();
  res.send(doctors)


})

// create doctors
 app.post('/doctors',verifyJWT, verifyAdmin,  async(req,res)=>{
  const doctor = req.body;
const result = await doctorsCollections.insertOne(doctor) 
res.send(result); 
})
// delete doctor
app.delete('/doctors/:id',verifyJWT, verifyAdmin, async(req,res)=>{
 const id = req.params.id;
 const filter = {_id: new ObjectId(id)}
 const result = await doctorsCollections.deleteOne(filter);
 res.send(result)
})



// save payment data
 app.post('/payments',async(req,res)=>{
  const payment = req.body;
  const result = await paymentCollections.insertOne(payment);
  const id = payment.bookingId
const filter = {_id: new ObjectId(id)}
const updatedDoc = {
  $set:{
    paid: true,
    transactionId:payment.transactionId
  }
}

const updatedResult = await bookingsCollections.updateOne(filter,updatedDoc)
  res.send(result)
 })

  }

  finally {

  }
}

run().catch(console.log);


// async function run() {
//   try {
//     // Connect the client to the server	(optional starting in v4.7)
//     await client.connect();
//     // Send a ping to confirm a successful connection
//     await client.db("admin").command({ ping: 1 });
//     console.log("Pinged your deployment. You successfully connected to MongoDB!");
//   } finally {
//     // Ensures that the client will close when you finish/error
//     await client.close();
//   }
// }
// run().catch(console.dir);




app.get('/', async (req, res) => {
  res.send("doctors portal server is running")
})

app.listen(port, () => console.log(`Doctors Portal Running on ${port}`))
