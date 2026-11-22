// Generic sample data shown in demo mode only (before the Google Sheet is connected).
// Contains no real family data.
window.FAMILY_BOARD_DEMO = function(){
  const d = (n) => { const t = new Date(); t.setDate(t.getDate()+n); return t.toISOString().slice(0,10); };
  return {
    settings: { title: "Family Board", members: ["Person 1","Person 2","Person 3"] },
    events: [
      { id:"d1", title:"Bin day", date:d(1), time:"07:00", end:"", location:"", notes:"Example event" },
      { id:"d2", title:"Example appointment", date:d(3), time:"15:30", end:"16:30", location:"", notes:"" },
      { id:"d3", title:"Weekend away (example)", date:d(10), time:"", end:"", location:"", notes:"" }
    ],
    shopping: [
      { id:"s1", item:"Milk", qty:"2 pints", category:"Dairy & eggs", by:"Person 1", done:false },
      { id:"s2", item:"Bananas", qty:"", category:"Fruit & veg", by:"Person 3", done:false },
      { id:"s3", item:"Washing-up liquid", qty:"", category:"Household", by:"Person 2", done:true }
    ],
    todos: [
      { id:"t1", task:"Put the bins out", assignee:"Person 3", due:d(0), done:false, by:"Person 1" },
      { id:"t2", task:"Book the car service", assignee:"Person 1", due:d(5), done:false, by:"Person 2" }
    ],
    meals: [
      { id:"m1", date:d(2), title:"Pasta night", notes:"Example meal", recipes:[] }
    ],
    trips: [
      { id:"tr1", name:"Example city break", when:"Next spring", details:"Dates, travel and bookings to be confirmed", status:"Planning" }
    ],
    notes: [
      { id:"n1", text:"Welcome! This is demo mode. Open ⚙︎ Settings to connect the family Google Sheet.", by:"Grok Bot", pinned:true, createdAt:new Date().toISOString() }
    ]
  };
};
